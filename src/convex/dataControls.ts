import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { backbone } from "./agentDef";
import { currentIdentity } from "./identity";

// Export and deletion controls for private business data (issue #49).
//
// Retention policy (documented, enforced below):
// - Profile facts, readiness plans (track rows), and conversation threads
//   belong to the signed-in account and are exported or deleted on request.
// - Shared catalog data (opportunities, evidence, guides, providers, flags,
//   drafts) is never touched by user data controls.
// - Another user's records are unreachable: every read/write scopes to the
//   server-derived account identity.
// - Anonymous device-local rows stay usable without an account; an
//   authenticated user may also sweep a named device id in the same delete.
// - Agent message history is deleted per thread; mapping rows are removed
//   even if component cleanup of a thread fails, so nothing stays reachable.

async function requireAccount(ctx: QueryCtx | MutationCtx): Promise<string> {
  const ident = await currentIdentity(ctx);
  if (ident.kind !== "user") throw new Error("Sign in to manage your data.");
  return ident.id;
}

export const inventory = query({
  args: {},
  returns: v.object({
    profileFields: v.array(v.string()),
    plans: v.array(
      v.object({ opportunityId: v.id("opportunities"), title: v.string(), status: v.string() }),
    ),
    conversations: v.array(
      v.object({ opportunityId: v.id("opportunities"), title: v.string(), updatedAt: v.number() }),
    ),
  }),
  handler: async (ctx) => {
    const accountKey = await requireAccount(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerKey", accountKey))
      .unique();
    const profileFields = profile
      ? ([
          "firstName",
          "state",
          "sector",
          "businessStage",
          "cac",
          "staffSize",
          "age",
          "womenLed",
          "needs",
          "reminderDays",
          "lowData",
          "language",
        ] as const).filter((f) => profile[f] !== undefined)
      : [];
    const tracks = await ctx.db
      .query("track")
      .withIndex("by_device", (q) => q.eq("deviceId", accountKey))
      .take(100);
    const plans = [];
    for (const r of tracks) {
      const opp = await ctx.db.get("opportunities", r.opportunityId);
      plans.push({ opportunityId: r.opportunityId, title: opp?.title ?? "Unknown", status: r.status });
    }
    const threads = await ctx.db
      .query("chatThreads")
      .withIndex("by_device", (q) => q.eq("deviceId", accountKey))
      .take(50);
    const conversations = [];
    for (const t of threads) {
      const opp = await ctx.db.get("opportunities", t.opportunityId);
      conversations.push({ opportunityId: t.opportunityId, title: opp?.title ?? t.title, updatedAt: t.updatedAt });
    }
    return { profileFields, plans, conversations };
  },
});

export const exportMyData = query({
  args: {},
  returns: v.object({
    exportedAt: v.number(),
    profile: v.union(
      v.object({
        firstName: v.optional(v.string()),
        state: v.optional(v.string()),
        sector: v.optional(v.string()),
        businessStage: v.optional(v.string()),
        cac: v.optional(v.string()),
        staffSize: v.optional(v.number()),
        age: v.optional(v.string()),
        womenLed: v.optional(v.boolean()),
        needs: v.optional(v.array(v.string())),
        reminderDays: v.optional(v.array(v.number())),
        lowData: v.optional(v.boolean()),
        language: v.optional(v.string()),
        email: v.optional(v.string()),
      }),
      v.null(),
    ),
    plans: v.array(
      v.object({
        opportunityId: v.id("opportunities"),
        title: v.string(),
        status: v.string(),
        ticked: v.array(v.number()),
        guideCriterionKey: v.optional(v.string()),
        guideTitle: v.optional(v.string()),
        guideDoneAt: v.optional(v.number()),
        abandonReason: v.optional(v.string()),
        updatedAt: v.number(),
      }),
    ),
    conversations: v.array(
      v.object({
        opportunityId: v.id("opportunities"),
        title: v.string(),
        threadId: v.string(),
        updatedAt: v.number(),
      }),
    ),
    outcomes: v.array(
      v.object({
        opportunityId: v.id("opportunities"),
        title: v.string(),
        outcome: v.string(),
        reasonCode: v.optional(v.string()),
        reportedBy: v.string(),
        updatedAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const accountKey = await requireAccount(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerKey", accountKey))
      .unique();
    const tracks = await ctx.db
      .query("track")
      .withIndex("by_device", (q) => q.eq("deviceId", accountKey))
      .take(100);
    const plans = [];
    for (const r of tracks) {
      const opp = await ctx.db.get("opportunities", r.opportunityId);
      plans.push({
        opportunityId: r.opportunityId,
        title: opp?.title ?? "Unknown",
        status: r.status,
        ticked: r.ticked,
        guideCriterionKey: r.guideCriterionKey,
        guideTitle: r.guideTitle,
        guideDoneAt: r.guideDoneAt,
        abandonReason: r.abandonReason,
        updatedAt: r.updatedAt,
      });
    }
    const threads = await ctx.db
      .query("chatThreads")
      .withIndex("by_device", (q) => q.eq("deviceId", accountKey))
      .take(50);
    const conversations = [];
    for (const t of threads) {
      const opp = await ctx.db.get("opportunities", t.opportunityId);
      conversations.push({
        opportunityId: t.opportunityId,
        title: opp?.title ?? t.title,
        threadId: t.threadId,
        updatedAt: t.updatedAt,
      });
    }
    const outcomeRows = await ctx.db
      .query("planOutcomes")
      .withIndex("by_owner", (q) => q.eq("ownerKey", accountKey))
      .take(50);
    const outcomes = [];
    for (const oc of outcomeRows) {
      const opp = await ctx.db.get("opportunities", oc.opportunityId);
      outcomes.push({
        opportunityId: oc.opportunityId,
        title: opp?.title ?? "Unknown",
        outcome: oc.outcome,
        reasonCode: oc.reasonCode,
        reportedBy: oc.reportedBy,
        updatedAt: oc.updatedAt,
      });
    }
    return {
      exportedAt: Date.now(),
      profile: profile
        ? {
            firstName: profile.firstName,
            state: profile.state,
            sector: profile.sector,
            businessStage: profile.businessStage,
            cac: profile.cac,
            staffSize: profile.staffSize,
            age: profile.age,
            womenLed: profile.womenLed,
            needs: profile.needs,
            reminderDays: profile.reminderDays,
            lowData: profile.lowData,
            language: profile.language,
            email: profile.email,
          }
        : null,
      plans,
      conversations,
      outcomes,
    };
  },
});

export const deleteMyData = mutation({
  args: {
    confirmation: v.string(),
    alsoDeviceId: v.optional(v.string()),
  },
  returns: v.object({
    deleted: v.object({ profile: v.boolean(), plans: v.number(), conversations: v.number(), documents: v.number(), outcomes: v.number() }),
  }),
  handler: async (ctx, args) => {
    const accountKey = await requireAccount(ctx);
    // Explicit confirmation: anything else (including cancellation, which
    // simply never calls) leaves every record intact.
    if (args.confirmation !== "DELETE") {
      throw new Error('Type DELETE to confirm. Nothing was deleted.');
    }
    const keys = [accountKey];
    if (args.alsoDeviceId && args.alsoDeviceId !== accountKey) {
      if (args.alsoDeviceId.startsWith("user:")) throw new Error("Invalid identifier.");
      keys.push(args.alsoDeviceId);
    }
    let profile = false;
    let plans = 0;
    let conversations = 0;
    let documents = 0;
    let outcomes = 0;
    for (const key of keys) {
      const existing = await ctx.db
        .query("profiles")
        .withIndex("by_owner", (q) => q.eq("ownerKey", key))
        .unique();
      if (existing) {
        await ctx.db.delete("profiles", existing._id);
        profile = true;
      }
      const tracks = await ctx.db
        .query("track")
        .withIndex("by_device", (q) => q.eq("deviceId", key))
        .take(100);
      for (const r of tracks) {
        await ctx.db.delete("track", r._id);
        plans += 1;
      }
      const threads = await ctx.db
        .query("chatThreads")
        .withIndex("by_device", (q) => q.eq("deviceId", key))
        .take(50);
      for (const t of threads) {
        if (!t.threadId.startsWith("local-")) {
          try {
            await backbone.deleteThreadAsync(ctx, { threadId: t.threadId });
          } catch {
            // Mapping row is still removed below; nothing stays reachable.
          }
        }
        await ctx.db.delete("chatThreads", t._id);
        conversations += 1;
      }
      const docs = await ctx.db
        .query("userDocuments")
        .withIndex("by_owner", (q) => q.eq("ownerKey", key))
        .take(50);
      for (const d of docs) {
        await ctx.db.delete("userDocuments", d._id);
        documents += 1;
      }
      const outcomeRows = await ctx.db
        .query("planOutcomes")
        .withIndex("by_owner", (q) => q.eq("ownerKey", key))
        .take(50);
      for (const oc of outcomeRows) {
        await ctx.db.delete("planOutcomes", oc._id);
        outcomes += 1;
      }
    }
    return { deleted: { profile, plans, conversations, documents, outcomes } };
  },
});
