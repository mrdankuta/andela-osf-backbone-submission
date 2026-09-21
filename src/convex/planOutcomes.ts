import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { effectiveOwnerKey } from "./identity";
import { requireCurator } from "./curation";

// Application outcomes (issue #55).
//
// After following a plan, the entrepreneur records what happened. Outcomes
// are revisable, carry user-vs-provider provenance, and can be excluded
// from aggregate learning or deleted through privacy controls. Abandonment
// reasons stay optional and structured, never demanding sensitive detail.

export const OUTCOMES = ["submitted", "shortlisted", "rejected", "funded", "abandoned"] as const;

const REASON_CODES: Record<string, string[]> = {
  submitted: [],
  shortlisted: [],
  rejected: ["not-eligible", "incomplete-docs", "missed-deadline", "no-response", "other"],
  funded: [],
  abandoned: ["too-complex", "fees", "lost-interest", "ineligible-found-late", "other"],
};

const outcomeValidator = v.union(
  v.literal("submitted"),
  v.literal("shortlisted"),
  v.literal("rejected"),
  v.literal("funded"),
  v.literal("abandoned"),
);

export const recordOutcome = mutation({
  args: {
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    outcome: outcomeValidator,
    reasonCode: v.optional(v.string()),
    reasonOther: v.optional(v.string()),
    includeInLearning: v.optional(v.boolean()),
  },
  returns: v.id("planOutcomes"),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    const allowed = REASON_CODES[args.outcome] ?? [];
    if (args.reasonCode && !allowed.includes(args.reasonCode)) {
      throw new Error(`Reason ${args.reasonCode} does not apply to ${args.outcome}.`);
    }
    if (args.reasonCode === "other" && !args.reasonOther?.trim()) {
      throw new Error("Describe the other reason in one line — no sensitive detail needed.");
    }
    const existing = await ctx.db
      .query("planOutcomes")
      .withIndex("by_owner_opp", (q) => q.eq("ownerKey", ownerKey).eq("opportunityId", args.opportunityId))
      .unique();
    const now = Date.now();
    if (!existing) {
      return await ctx.db.insert("planOutcomes", {
        ownerKey,
        opportunityId: args.opportunityId,
        outcome: args.outcome,
        reasonCode: args.reasonCode,
        reasonOther: args.reasonCode === "other" ? args.reasonOther?.trim() : undefined,
        reportedBy: "user",
        includeInLearning: args.includeInLearning ?? true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch("planOutcomes", existing._id, {
      outcome: args.outcome,
      reasonCode: args.reasonCode,
      reasonOther: args.reasonCode === "other" ? args.reasonOther?.trim() : undefined,
      reportedBy: "user",
      includeInLearning: args.includeInLearning ?? existing.includeInLearning,
      updatedAt: now,
    });
    return existing._id;
  },
});

export const confirmOutcome = mutation({
  args: {
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    outcome: outcomeValidator,
  },
  returns: v.id("planOutcomes"),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const existing = await ctx.db
      .query("planOutcomes")
      .withIndex("by_owner_opp", (q) => q.eq("ownerKey", args.ownerKey).eq("opportunityId", args.opportunityId))
      .unique();
    const now = Date.now();
    if (!existing) {
      return await ctx.db.insert("planOutcomes", {
        ownerKey: args.ownerKey,
        opportunityId: args.opportunityId,
        outcome: args.outcome,
        reportedBy: "provider",
        includeInLearning: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch("planOutcomes", existing._id, {
      outcome: args.outcome,
      reportedBy: "provider",
      updatedAt: now,
    });
    return existing._id;
  },
});

export const deleteOutcome = mutation({
  args: { ownerKey: v.string(), opportunityId: v.id("opportunities") },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const existing = await ctx.db
      .query("planOutcomes")
      .withIndex("by_owner_opp", (q) => q.eq("ownerKey", ownerKey).eq("opportunityId", args.opportunityId))
      .unique();
    if (!existing) return null;
    await ctx.db.delete("planOutcomes", existing._id);
    return true as const;
  },
});

export const setOutcomeSharing = mutation({
  args: { ownerKey: v.string(), opportunityId: v.id("opportunities"), includeInLearning: v.boolean() },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const existing = await ctx.db
      .query("planOutcomes")
      .withIndex("by_owner_opp", (q) => q.eq("ownerKey", ownerKey).eq("opportunityId", args.opportunityId))
      .unique();
    if (!existing) return null;
    await ctx.db.patch("planOutcomes", existing._id, {
      includeInLearning: args.includeInLearning,
      updatedAt: Date.now(),
    });
    return true as const;
  },
});

export const myOutcomes = query({
  args: { ownerKey: v.string() },
  returns: v.array(schema.doc("planOutcomes")),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    return await ctx.db
      .query("planOutcomes")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .take(50);
  },
});

export const outcomeInsights = query({
  args: {},
  returns: v.array(
    v.object({ outcome: v.string(), reasonCode: v.union(v.string(), v.null()), count: v.number() }),
  ),
  handler: async (ctx) => {
    await requireCurator(ctx);
    const rows = await ctx.db.query("planOutcomes").take(500);
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.includeInLearning) continue;
      const key = `${r.outcome}||${r.reasonCode ?? ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => {
      const [outcome, reasonCode] = key.split("||");
      return { outcome, reasonCode: reasonCode || null, count };
    });
  },
});
