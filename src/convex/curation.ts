import { action, env, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { authComponent } from "./auth";
import { findConflicts, judgePassageRelation } from "./evidencePolicy";
import { recheckExpectation, routeReport } from "./reportPolicy";
import { OPENROUTER_DECISIONS_URL, OPENROUTER_JEV_MODEL } from "./profileInterpretation";

// Curator gate: /admin UI + these mutations are NOT for end users.
// - Anonymous callers are rejected in production.
// - If ADMIN_EMAILS is set (convex env), only those emails pass.
// - If unset, any signed-in user passes (demo mode) — set it before launch.
// - The test-env fallback applies ONLY under vitest (convex-test has no auth
//   component). Any other auth failure means anonymous: reject.
async function currentUser(ctx: QueryCtx | MutationCtx) {
  try {
    return await authComponent.getAuthUser(ctx);
  } catch {
    if (process.env.VITEST) return "test-env" as const;
    throw new Error("Curator sign-in required.");
  }
}

export function emailAllowed(email: string | undefined | null) {
  const allow = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return true;
  return !!email && allow.includes(email.toLowerCase());
}

export type CuratorUser = { email?: string | null } | null | undefined;

export function resolveCuratorAccess(
  user: CuratorUser | "test-env",
  allowlist: string,
): { ok: true; reviewer: string } | { ok: false; reason: string } {
  if (user === "test-env") return { ok: true, reviewer: "test-env" };
  if (!user) return { ok: false, reason: "Curator sign-in required." };
  const allow = allowlist
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return { ok: true, reviewer: user.email ?? "curator" };
  if (user.email && allow.includes(user.email.toLowerCase())) {
    return { ok: true, reviewer: user.email };
  }
  return { ok: false, reason: "Curator access only." };
}

export async function requireCurator(ctx: QueryCtx | MutationCtx) {
  const user = (await currentUser(ctx)) as CuratorUser | "test-env";
  const res = resolveCuratorAccess(user, process.env.ADMIN_EMAILS ?? "");
  if (!res.ok) throw new Error(res.reason);
}

export async function reviewerIdentity(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = (await currentUser(ctx)) as CuratorUser | "test-env";
  const res = resolveCuratorAccess(user, process.env.ADMIN_EMAILS ?? "");
  return res.ok ? res.reviewer : "unknown";
}

export const isCurator = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (user === "test-env") return { authed: false, curator: true };
    if (!user) return { authed: false, curator: false };
    return { authed: true, curator: emailAllowed(user.email) };
  },
});

const reportCategory = v.union(
  v.literal("broken-source"),
  v.literal("wrong-deadline"),
  v.literal("ended-program"),
  v.literal("suspected-scam"),
  v.literal("incorrect-eligibility"),
  v.literal("other"),
);

export const report = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    category: reportCategory,
    claimKey: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.object({
    flagId: v.id("flags"),
    category: v.string(),
    priority: v.union(v.literal("now"), v.literal("queue")),
    duplicate: v.boolean(),
    recheckWithinHours: v.number(),
  }),
  handler: async (ctx, args) => {
    // Public: any user can flag a bad listing, anonymously. No auth required,
    // and no personal data is collected or stored.
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    const open = await ctx.db.query("flags").withIndex("by_status", (q) => q.eq("status", "open")).take(50);
    const duplicate = open.find(
      (f) => f.opportunityId === args.opportunityId && (f.category ?? "other") === args.category,
    );
    const routed = routeReport({ category: args.category, claimKey: args.claimKey });
    if (duplicate) {
      await ctx.db.patch("flags", duplicate._id, {
        duplicateCount: (duplicate.duplicateCount ?? 0) + 1,
      });
      return {
        flagId: duplicate._id,
        category: args.category,
        priority: duplicate.priority ?? routed.priority,
        duplicate: true,
        recheckWithinHours: recheckExpectation(duplicate.priority ?? routed.priority),
      };
    }
    const flagId = await ctx.db.insert("flags", {
      opportunityId: args.opportunityId,
      reason: args.category,
      note: args.note?.trim() || undefined,
      status: "open",
      createdAt: Date.now(),
      category: args.category,
      claimKey: args.claimKey?.trim() || undefined,
      priority: routed.priority,
      routingConfidence: routed.confidence,
      duplicateCount: 0,
    });
    return {
      flagId,
      category: args.category,
      priority: routed.priority,
      duplicate: false,
      recheckWithinHours: recheckExpectation(routed.priority),
    };
  },
});

export const reportStatus = query({
  args: { flagId: v.id("flags") },
  returns: v.union(
    v.object({
      status: v.union(v.literal("open"), v.literal("resolved")),
      category: v.string(),
      priority: v.union(v.literal("now"), v.literal("queue")),
      createdAt: v.number(),
      outcome: v.optional(v.union(v.literal("fixed"), v.literal("no-issue"), v.literal("escalated"))),
      resolvedNote: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Public and safe: flags carry no personal data, only review metadata.
    const flag = await ctx.db.get("flags", args.flagId);
    if (!flag) return null;
    return {
      status: flag.status,
      category: flag.category ?? "other",
      priority: flag.priority ?? "queue",
      createdAt: flag.createdAt,
      outcome: flag.outcome,
      resolvedNote: flag.status === "resolved" ? flag.resolvedNote : undefined,
    };
  },
});

export const queue = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("flags"),
      opportunityId: v.id("opportunities"),
      opportunityTitle: v.string(),
      reason: v.string(),
      note: v.optional(v.string()),
      status: v.union(v.literal("open"), v.literal("resolved")),
      createdAt: v.number(),
      category: v.optional(v.string()),
      claimKey: v.optional(v.string()),
      priority: v.optional(v.union(v.literal("now"), v.literal("queue"))),
      routingConfidence: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
      duplicateCount: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    await requireCurator(ctx);
    const flags = await ctx.db.query("flags").withIndex("by_status", (q) => q.eq("status", "open")).take(50);
    const out = [];
    for (const f of flags) {
      const opp = await ctx.db.get("opportunities", f.opportunityId);
      out.push({
        _id: f._id,
        opportunityId: f.opportunityId,
        opportunityTitle: opp?.title ?? "Unknown",
        reason: f.reason,
        note: f.note,
        status: f.status,
        createdAt: f.createdAt,
        category: f.category,
        claimKey: f.claimKey,
        priority: f.priority,
        routingConfidence: f.routingConfidence,
        duplicateCount: f.duplicateCount,
      });
    }
    out.sort((a, b) => {
      const rank = (p?: string) => (p === "now" ? 0 : 1);
      return rank(a.priority) - rank(b.priority) || b.createdAt - a.createdAt;
    });
    return out;
  },
});

export const resolveReport = mutation({
  args: {
    flagId: v.id("flags"),
    outcome: v.union(v.literal("fixed"), v.literal("no-issue"), v.literal("escalated")),
    note: v.optional(v.string()),
    staleLinkedClaims: v.optional(v.boolean()),
  },
  returns: v.object({ outcome: v.string(), effects: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const flag = await ctx.db.get("flags", args.flagId);
    if (!flag) throw new Error("Report not found.");
    if (flag.status !== "open") throw new Error("This report is already resolved.");
    const reviewer = await reviewerIdentity(ctx);
    const now = Date.now();
    const effects: string[] = [];
    if (args.outcome === "fixed") {
      const category = flag.category ?? "other";
      if (category === "ended-program") {
        await ctx.db.patch("opportunities", flag.opportunityId, { status: "expired" });
        effects.push("Opportunity marked expired.");
      } else if (category === "suspected-scam") {
        await ctx.db.patch("opportunities", flag.opportunityId, { catalogVisibility: "hidden" });
        effects.push("Opportunity hidden from the catalog pending verification.");
      } else if (category === "broken-source") {
        await ctx.db.patch("opportunities", flag.opportunityId, { sourceStatus: "unavailable" });
        effects.push("Source marked unavailable.");
      }
      if (args.staleLinkedClaims && flag.claimKey) {
        const rows = await ctx.db
          .query("opportunityEvidence")
          .withIndex("by_opportunityId", (q) => q.eq("opportunityId", flag.opportunityId))
          .take(50);
        let marked = 0;
        for (const row of rows) {
          if (row.claimKey !== flag.claimKey || row.status === "pending-review") continue;
          await ctx.db.patch("opportunityEvidence", row._id, {
            status: "pending-review",
            note: `Community report confirmed by ${reviewer} — needs re-verification.`,
            checkedAt: now,
          });
          marked += 1;
        }
        effects.push(`${marked} linked claim${marked === 1 ? "" : "s"} marked for re-verification.`);
      }
    }
    await ctx.db.patch("flags", args.flagId, {
      status: "resolved",
      outcome: args.outcome,
      resolvedNote: args.note?.trim() || undefined,
      resolvedBy: reviewer,
      resolvedAt: now,
    });
    return { outcome: args.outcome, effects };
  },
});

export const publish = mutation({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const conflicts = await openConflicts(ctx, args.opportunityId);
    if (conflicts.length > 0) {
      throw new Error(
        `Unresolved contradictions block publication: ${conflicts.map((c) => c.claimKey).join(", ")}.`,
      );
    }
    await ctx.db.patch("opportunities", args.opportunityId, {
      status: "verified",
      catalogVisibility: "public",
      lastVerified: Date.now(),
    });
    const flags = await ctx.db.query("flags").withIndex("by_status", (q) => q.eq("status", "open")).take(50);
    for (const f of flags) {
      if (f.opportunityId === args.opportunityId) await ctx.db.patch("flags", f._id, { status: "resolved" });
    }
    return true;
  },
});

export const saveSteps = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    steps: v.array(v.object({ order: v.number(), title: v.string(), detail: v.string(), link: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    await ctx.db.patch("opportunities", args.opportunityId, { steps: args.steps });
    return true;
  },
});

async function openConflicts(ctx: QueryCtx | MutationCtx, opportunityId: Id<"opportunities">) {
  const rows = await ctx.db
    .query("opportunityEvidence")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(50);
  return findConflicts(rows);
}

export const recordContradiction = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    claimKey: v.string(),
    sourceUrl: v.string(),
    sourcePassage: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.id("opportunityEvidence"),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    if (!args.claimKey.trim()) throw new Error("A claim key is required.");
    if (!args.sourcePassage.trim()) throw new Error("The contradicting passage is required.");
    let url: URL;
    try {
      url = new URL(args.sourceUrl);
    } catch {
      throw new Error("The contradicting source must be a valid URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("The contradicting source must be a valid URL.");
    }
    const reviewer = await reviewerIdentity(ctx);
    return await ctx.db.insert("opportunityEvidence", {
      opportunityId: args.opportunityId,
      claimType: "eligibility",
      claimKey: args.claimKey.trim(),
      displayValue: args.claimKey.trim(),
      status: "contradicted",
      sourceUrl: args.sourceUrl,
      sourcePassage: args.sourcePassage.trim(),
      note: args.note?.trim() ? `${args.note.trim()} (recorded by ${reviewer})` : `Recorded by ${reviewer}.`,
      checkedAt: Date.now(),
    });
  },
});

export const resolveEvidence = mutation({
  args: {
    evidenceId: v.id("opportunityEvidence"),
    status: v.union(v.literal("supported"), v.literal("unsupported")),
    note: v.optional(v.string()),
  },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const row = await ctx.db.get("opportunityEvidence", args.evidenceId);
    if (!row) throw new Error("Evidence not found.");
    const reviewer = await reviewerIdentity(ctx);
    await ctx.db.patch("opportunityEvidence", args.evidenceId, {
      status: args.status,
      note: args.note?.trim()
        ? `${args.note.trim()} (resolved by ${reviewer})`
        : `Resolved by ${reviewer}.`,
      checkedAt: Date.now(),
    });
    return true as const;
  },
});

export const conflictQueue = query({
  args: {},
  returns: v.array(
    v.object({
      opportunityId: v.id("opportunities"),
      opportunityTitle: v.string(),
      conflicts: v.array(
        v.object({
          claimKey: v.string(),
          supported: v.array(
            v.object({
              _id: v.id("opportunityEvidence"),
              sourceUrl: v.string(),
              sourcePassage: v.optional(v.string()),
              note: v.optional(v.string()),
            }),
          ),
          contradicted: v.array(
            v.object({
              _id: v.id("opportunityEvidence"),
              sourceUrl: v.string(),
              sourcePassage: v.optional(v.string()),
              note: v.optional(v.string()),
            }),
          ),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    await requireCurator(ctx);
    const opportunities = await ctx.db.query("opportunities").take(100);
    const out = [];
    for (const o of opportunities) {
      const conflicts = await openConflicts(ctx, o._id);
      if (conflicts.length === 0) continue;
      out.push({
        opportunityId: o._id,
        opportunityTitle: o.title,
        conflicts: conflicts.map((c) => ({
          claimKey: c.claimKey,
          supported: c.supported.map((r) => ({
            _id: r._id,
            sourceUrl: r.sourceUrl,
            sourcePassage: r.sourcePassage,
            note: r.note,
          })),
          contradicted: c.contradicted.map((r) => ({
            _id: r._id,
            sourceUrl: r.sourceUrl,
            sourcePassage: r.sourcePassage,
            note: r.note,
          })),
        })),
      });
    }
    return out;
  },
});

export const comparePassages = action({
  args: { claim: v.string(), passage: v.string() },
  returns: v.object({
    relation: v.union(
      v.literal("supports"),
      v.literal("contradicts"),
      v.literal("unrelated"),
      v.literal("uncertain"),
    ),
    confidence: v.number(),
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
          if (!res.ok) throw new Error(`Passage judgment failed with status ${res.status}`);
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
    return await judgePassageRelation(args.claim, args.passage, judge);
  },
});
