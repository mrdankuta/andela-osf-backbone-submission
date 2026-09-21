import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { stripHtml } from "../lib/import-extractor";
import { displayFreshness, hashText, judgeContentChange, tokenSignature } from "../lib/source-monitor";

const CHECK_TIMEOUT_MS = 15000;

export const snapshotForCheck = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      opportunityId: v.id("opportunities"),
      sourceUrl: v.string(),
      prevHash: v.union(v.string(), v.null()),
      prevSig: v.union(v.array(v.string()), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const verified = await ctx.db
      .query("opportunities")
      .withIndex("by_status", (q) => q.eq("status", "verified"))
      .take(100);
    const out = [];
    for (const o of verified) {
      const checks = await ctx.db
        .query("sourceChecks")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", o._id))
        .take(20);
      const latest = checks.sort((a, b) => b.checkedAt - a.checkedAt)[0];
      out.push({
        opportunityId: o._id,
        sourceUrl: o.sourceUrl,
        prevHash: latest?.contentHash ?? null,
        prevSig: latest?.tokenSig ?? null,
      });
    }
    return out;
  },
});

export const applyCheck = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    sourceUrl: v.string(),
    checkedAt: v.number(),
    reachable: v.boolean(),
    statusCode: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    contentLength: v.optional(v.number()),
    tokenSig: v.optional(v.array(v.string())),
    changed: v.boolean(),
    meaningfulChange: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.object({ state: v.string(), flagged: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.db.insert("sourceChecks", {
      opportunityId: args.opportunityId,
      sourceUrl: args.sourceUrl,
      checkedAt: args.checkedAt,
      reachable: args.reachable,
      statusCode: args.statusCode,
      contentHash: args.contentHash,
      contentLength: args.contentLength,
      tokenSig: args.tokenSig,
      changed: args.changed,
      meaningfulChange: args.meaningfulChange,
      error: args.error,
    });
    let state = "ok";
    let flagged = false;
    if (!args.reachable) {
      state = "unavailable";
      await ctx.db.insert("flags", {
        opportunityId: args.opportunityId,
        reason: "Source unreachable",
        note: args.error ?? `HTTP ${args.statusCode ?? "unknown"}`,
        status: "open",
        createdAt: args.checkedAt,
      });
      flagged = true;
    } else if (args.meaningfulChange) {
      state = "stale";
      const claims = await ctx.db
        .query("opportunityEvidence")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.opportunityId))
        .take(50);
      let marked = 0;
      for (const c of claims) {
        if (c.status !== "supported") continue;
        await ctx.db.patch("opportunityEvidence", c._id, {
          status: "pending-review",
          note: `Source changed on ${new Date(args.checkedAt).toLocaleDateString()} — was supported, needs recheck.`,
          checkedAt: args.checkedAt,
        });
        marked += 1;
      }
      await ctx.db.insert("flags", {
        opportunityId: args.opportunityId,
        reason: "Source changed",
        note: `${marked} supported claim${marked === 1 ? "" : "s"} marked pending-review.`,
        status: "open",
        createdAt: args.checkedAt,
      });
      flagged = true;
    }
    await ctx.db.patch("opportunities", args.opportunityId, {
      lastChecked: args.checkedAt,
      sourceStatus: state as "ok" | "stale" | "unavailable",
    });
    return { state, flagged };
  },
});

export const checkPublishedSources = internalAction({
  args: {},
  returns: v.object({
    checked: v.number(),
    unchanged: v.number(),
    changed: v.number(),
    meaningful: v.number(),
    unreachable: v.number(),
  }),
  handler: async (ctx) => {
    const snapshot: { opportunityId: string; sourceUrl: string; prevHash: string | null; prevSig: string[] | null }[] =
      await ctx.runQuery(internal.sourceMonitor.snapshotForCheck, {});
    const summary = { checked: 0, unchanged: 0, changed: 0, meaningful: 0, unreachable: 0 };
    for (const row of snapshot) {
      const checkedAt = Date.now();
      let res: Response | null = null;
      let error: string | undefined;
      try {
        res = await fetch(row.sourceUrl, {
          headers: { "user-agent": "BackboneAfrica-monitor/1.0" },
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
      } catch (e) {
        error = e instanceof Error ? e.message : "fetch failed";
      }
      if (!res || !res.ok) {
        await ctx.runMutation(internal.sourceMonitor.applyCheck, {
          opportunityId: row.opportunityId as never,
          sourceUrl: row.sourceUrl,
          checkedAt,
          reachable: false,
          statusCode: res?.status,
          changed: false,
          meaningfulChange: false,
          error: error ?? `HTTP ${res?.status ?? "unknown"}`,
        });
        summary.checked += 1;
        summary.unreachable += 1;
        continue;
      }
      const text = stripHtml(await res.text());
      const verdict = judgeContentChange(row.prevHash, row.prevSig, text);
      await ctx.runMutation(internal.sourceMonitor.applyCheck, {
        opportunityId: row.opportunityId as never,
        sourceUrl: row.sourceUrl,
        checkedAt,
        reachable: true,
        statusCode: res.status,
        contentHash: hashText(text),
        contentLength: text.length,
        tokenSig: tokenSignature(text),
        changed: verdict.changed,
        meaningfulChange: verdict.changed && verdict.meaningful,
      });
      summary.checked += 1;
      if (!verdict.changed) summary.unchanged += 1;
      else {
        summary.changed += 1;
        if (verdict.meaningful) summary.meaningful += 1;
      }
    }
    return summary;
  },
});

export async function readFreshness(
  ctx: QueryCtx,
  opportunityId: Id<"opportunities">,
): Promise<{ state: "ok" | "stale" | "unavailable" | "under-review" | "closed"; lastChecked: number | null } | null> {
  const o = await ctx.db.get("opportunities", opportunityId);
  if (!o) return null;
  const flags = await ctx.db.query("flags").withIndex("by_status", (q) => q.eq("status", "open")).take(50);
  const hasOpenFlag = flags.some((f) => f.opportunityId === opportunityId);
  const checks = await ctx.db
    .query("sourceChecks")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(20);
  const latest = checks.sort((a, b) => b.checkedAt - a.checkedAt)[0];
  const changedUnreviewed =
    o.sourceStatus === "stale" || (latest?.meaningfulChange === true && hasOpenFlag);
  return displayFreshness({
    status: o.status,
    lastChecked: o.lastChecked,
    unreachable: latest !== undefined && !latest.reachable,
    changedUnreviewed,
    hasOpenFlag,
  });
}

export const getFreshness = query({
  args: { id: v.id("opportunities") },
  returns: v.union(
    v.object({
      state: v.union(
        v.literal("ok"),
        v.literal("stale"),
        v.literal("unavailable"),
        v.literal("under-review"),
        v.literal("closed"),
      ),
      lastChecked: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => await readFreshness(ctx, args.id),
});
