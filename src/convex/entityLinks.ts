import { action, env, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireCurator, reviewerIdentity } from "./curation";
import {
  blockCandidates,
  judgePair,
  type EntityKind,
} from "./entityResolutionPolicy";
import { OPENROUTER_DECISIONS_URL, OPENROUTER_JEV_MODEL } from "./profileInterpretation";

const linkRelation = v.union(v.literal("same"), v.literal("related"), v.literal("cohort"));

/** Source ids absorbed by an active same-link: hidden from catalog reads. */
export async function collapsedSourceIds(ctx: QueryCtx, kind: EntityKind): Promise<Set<string>> {
  const links = await ctx.db
    .query("entityLinks")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .take(100);
  return new Set(
    links.filter((l) => l.kind === kind && l.relation === "same").map((l) => l.fromId),
  );
}

async function docExists(ctx: QueryCtx | MutationCtx, kind: EntityKind | "draft", id: string): Promise<boolean> {
  const getters: Record<string, () => Promise<unknown>> = {
    provider: () => ctx.db.get("providers", id as never),
    program: () => ctx.db.get("opportunities", id as never),
    draft: () => ctx.db.get("importDrafts", id as never),
  };
  const get = getters[kind];
  if (!get) return false;
  return (await get()) !== null;
}

export const linkEntities = mutation({
  args: {
    kind: v.union(v.literal("provider"), v.literal("program")),
    fromId: v.string(),
    toId: v.string(),
    relation: linkRelation,
    cohortLabel: v.optional(v.string()),
    note: v.optional(v.string()),
    fromKind: v.optional(v.union(v.literal("provider"), v.literal("program"), v.literal("draft"))),
  },
  returns: v.id("entityLinks"),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    if (args.fromId === args.toId) throw new Error("A record cannot link to itself.");
    const fromKind = args.fromKind ?? args.kind;
    if (!(await docExists(ctx, fromKind, args.fromId))) throw new Error("The source record does not exist.");
    if (!(await docExists(ctx, args.kind, args.toId))) throw new Error("The canonical record does not exist.");
    if (args.relation === "cohort" && !args.cohortLabel?.trim()) {
      throw new Error("Cohort links need a cohort label (for example 2026).");
    }
    const decidedBy = await reviewerIdentity(ctx);
    return await ctx.db.insert("entityLinks", {
      kind: args.kind,
      fromId: args.fromId,
      toId: args.toId,
      relation: args.relation,
      cohortLabel: args.cohortLabel?.trim(),
      note: args.note?.trim(),
      decidedBy,
      decidedAt: Date.now(),
      status: "active",
    });
  },
});

export const revertLink = mutation({
  args: { linkId: v.id("entityLinks") },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const link = await ctx.db.get("entityLinks", args.linkId);
    if (!link) throw new Error("Link not found.");
    await ctx.db.patch("entityLinks", args.linkId, { status: "reverted" });
    return true as const;
  },
});

export const listLinks = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("reverted"))) },
  returns: v.array(
    v.object({
      _id: v.id("entityLinks"),
      kind: v.union(v.literal("provider"), v.literal("program")),
      fromId: v.string(),
      fromName: v.string(),
      toId: v.string(),
      toName: v.string(),
      relation: linkRelation,
      cohortLabel: v.optional(v.string()),
      note: v.optional(v.string()),
      decidedBy: v.string(),
      decidedAt: v.number(),
      status: v.union(v.literal("active"), v.literal("reverted")),
    }),
  ),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const links = args.status
      ? await ctx.db.query("entityLinks").withIndex("by_status", (q) => q.eq("status", args.status!)).take(50)
      : await ctx.db.query("entityLinks").take(50);
    const out = [];
    for (const l of links) {
      out.push({
        _id: l._id,
        kind: l.kind,
        fromId: l.fromId,
        fromName: await resolveName(ctx, l.kind, l.fromId),
        toId: l.toId,
        toName: await resolveName(ctx, l.kind, l.toId),
        relation: l.relation,
        cohortLabel: l.cohortLabel,
        note: l.note,
        decidedBy: l.decidedBy,
        decidedAt: l.decidedAt,
        status: l.status,
      });
    }
    return out;
  },
});

async function resolveName(ctx: QueryCtx, kind: EntityKind, id: string): Promise<string> {
  if (kind === "provider") {
    const p = await ctx.db.get("providers", id as never);
    return p?.name ?? id;
  }
  const o = await ctx.db.get("opportunities", id as never);
  if (o) return o.title;
  const d = await ctx.db.get("importDrafts", id as never);
  const title = (d as { title?: { value?: string | null } } | null)?.title?.value;
  return title ?? d?.sourceUrl ?? id;
}

const suggestion = v.object({
  candidateId: v.string(),
  candidateName: v.string(),
  candidateSource: v.string(),
  relation: v.union(
    v.literal("same"),
    v.literal("related"),
    v.literal("cohort"),
    v.literal("different"),
    v.literal("review"),
  ),
  confidence: v.number(),
  reason: v.string(),
  cohortLabel: v.optional(v.string()),
});

export const suggestProgramLinks = query({
  args: { draftId: v.id("importDrafts") },
  returns: v.array(suggestion),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const draft = await ctx.db.get("importDrafts", args.draftId);
    if (!draft || draft.captureStatus !== "captured") return [];
    const opportunities = await ctx.db.query("opportunities").take(100);
    const incoming = { name: draft.title.value ?? draft.sourceUrl, source: draft.sourceUrl };
    const candidates = blockCandidates(
      incoming,
      opportunities,
      (o) => o.title,
      (o) => o.sourceUrl,
    );
    const out = [];
    for (const c of candidates) {
      const judgment = await judgePair(incoming, { name: c.title, source: c.sourceUrl });
      out.push({
        candidateId: c._id,
        candidateName: c.title,
        candidateSource: c.sourceUrl,
        relation: judgment.relation,
        confidence: judgment.confidence,
        reason: judgment.reason,
        cohortLabel: judgment.cohortLabel,
      });
    }
    return out;
  },
});

export const suggestProviderLinks = query({
  args: { name: v.string(), officialLink: v.optional(v.string()) },
  returns: v.array(suggestion),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    if (!args.name.trim()) return [];
    const providers = await ctx.db.query("providers").take(100);
    const incoming = { name: args.name, source: args.officialLink };
    const candidates = blockCandidates(
      incoming,
      providers,
      (p) => p.name,
      (p) => p.officialLink,
    );
    const out = [];
    for (const c of candidates) {
      const judgment = await judgePair(incoming, { name: c.name, source: c.officialLink });
      out.push({
        candidateId: c._id,
        candidateName: c.name,
        candidateSource: c.officialLink ?? "",
        relation: judgment.relation,
        confidence: judgment.confidence,
        reason: judgment.reason,
        cohortLabel: judgment.cohortLabel,
      });
    }
    return out;
  },
});

export const judgePairAction = action({
  args: {
    a: v.object({ name: v.string(), source: v.optional(v.string()) }),
    b: v.object({ name: v.string(), source: v.optional(v.string()) }),
  },
  returns: v.object({
    relation: v.union(
      v.literal("same"),
      v.literal("related"),
      v.literal("cohort"),
      v.literal("different"),
      v.literal("review"),
    ),
    confidence: v.number(),
    reason: v.string(),
    cohortLabel: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const judge = env.OPENROUTER_API_KEY
      ? async (
          questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>,
          state: Record<string, unknown>,
        ) => {
          const res = await fetch(OPENROUTER_DECISIONS_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: OPENROUTER_JEV_MODEL, state, questions }),
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) throw new Error(`Jev pair judgment failed with status ${res.status}`);
          const data: unknown = await res.json();
          const answers = (data as { answers?: unknown }).answers as
            | Record<string, { type?: unknown; choice?: unknown; confidence?: unknown }>
            | undefined;
          const out: Record<string, { choice: string; confidence: number } | undefined> = {};
          for (const [key, raw] of Object.entries(answers ?? {})) {
            if (raw?.type === "choice" && typeof raw.choice === "string" && typeof raw.confidence === "number") {
              out[key] = { choice: raw.choice, confidence: raw.confidence };
            }
          }
          return out;
        }
      : undefined;
    const judgment = await judgePair(args.a, args.b, judge);
    const relation = judgment.relation === "related" && judgment.cohortLabel ? "cohort" : judgment.relation;
    return {
      relation,
      confidence: judgment.confidence,
      reason: judgment.reason,
      cohortLabel: judgment.cohortLabel,
    };
  },
});

export type { EntityKind };
