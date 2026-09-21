import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { currentIdentity, effectiveOwnerKey } from "./identity";
import { recordConfirmedAnswers } from "./answerLedger";

const clearableField = v.union(
  v.literal("firstName"),
  v.literal("state"),
  v.literal("sector"),
  v.literal("businessStage"),
  v.literal("cac"),
  v.literal("staffSize"),
  v.literal("age"),
  v.literal("womenLed"),
  v.literal("needs"),
);
type ClearableField =
  | "firstName" | "state" | "sector" | "businessStage" | "cac"
  | "staffSize" | "age" | "womenLed" | "needs";

export const get = query({
  args: { ownerKey: v.string() },
  returns: v.union(schema.doc("profiles"), v.null()),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    return await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey)).unique();
  },
});

export const save = mutation({
  args: {
    ownerKey: v.string(),
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
    planUpdatesOptIn: v.optional(v.boolean()),
    clearFields: v.optional(v.array(clearableField)),
    source: v.optional(v.string()),
    sourceOpportunityId: v.optional(v.id("opportunities")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { ownerKey: suppliedKey, clearFields, source, sourceOpportunityId, ...rest } = args;
    const ownerKey = await effectiveOwnerKey(ctx, suppliedKey);
    const existing = await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey)).unique();
    if (!existing) {
      await ctx.db.insert("profiles", { ownerKey, ...rest, updatedAt: Date.now() });
    } else {
      const patch: {
        firstName?: string | undefined;
        state?: string | undefined;
        sector?: string | undefined;
        businessStage?: string | undefined;
        cac?: string | undefined;
        staffSize?: number | undefined;
        age?: string | undefined;
        womenLed?: boolean | undefined;
        needs?: string[] | undefined;
        reminderDays?: number[] | undefined;
        lowData?: boolean | undefined;
        language?: string | undefined;
        email?: string | undefined;
        planUpdatesOptIn?: boolean | undefined;
        updatedAt: number;
      } = { ...rest, updatedAt: Date.now() };
      for (const f of new Set<ClearableField>(clearFields ?? [])) {
        switch (f) {
          case "firstName": patch.firstName = undefined; break;
          case "state": patch.state = undefined; break;
          case "sector": patch.sector = undefined; break;
          case "businessStage": patch.businessStage = undefined; break;
          case "cac": patch.cac = undefined; break;
          case "staffSize": patch.staffSize = undefined; break;
          case "age": patch.age = undefined; break;
          case "womenLed": patch.womenLed = undefined; break;
          case "needs": patch.needs = undefined; break;
        }
      }
      await ctx.db.patch("profiles", existing._id, patch);
    }
    if (source) {
      await recordConfirmedAnswers(
        ctx,
        ownerKey,
        {
          state: args.state,
          sector: args.sector,
          businessStage: args.businessStage,
          cac: args.cac,
          staffSize: args.staffSize,
          age: args.age,
          womenLed: args.womenLed,
        },
        source,
        sourceOpportunityId,
      );
    }
    return true;
  },
});

const PLAN_STATUS_RANK: Record<string, number> = {
  qualifying: 0,
  saved: 0,
  ready: 1,
  applying: 2,
  "in-progress": 2,
  abandoned: 3,
  applied: 4,
};

const MERGEABLE_PROFILE_FIELDS = [
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
  "email",
  "planUpdatesOptIn",
] as const;

/** Claim this device's anonymous data into the signed-in account.
 *  Explicit, merge-preserving, and idempotent: a second run finds nothing
 *  left to migrate. Anonymous callers are refused — sign-in first. */
export const claimDeviceData = mutation({
  args: { deviceId: v.string() },
  returns: v.object({
    profileMigrated: v.boolean(),
    plansMigrated: v.number(),
    plansMerged: v.number(),
    threadsMigrated: v.number(),
    answersMigrated: v.number(),
    documentsMigrated: v.number(),
    outcomesMigrated: v.number(),
  }),
  handler: async (ctx, args) => {
    const ident = await currentIdentity(ctx);
    if (ident.kind !== "user") throw new Error("Sign in to back up this device.");
    const accountKey = ident.id;
    if (args.deviceId === accountKey) {
      return { profileMigrated: false, plansMigrated: 0, plansMerged: 0, threadsMigrated: 0, answersMigrated: 0, documentsMigrated: 0, outcomesMigrated: 0 };
    }
    let profileMigrated = false;
    const [deviceProfile, accountProfile] = await Promise.all([
      ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerKey", args.deviceId)).unique(),
      ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerKey", accountKey)).unique(),
    ]);
    if (deviceProfile && !accountProfile) {
      await ctx.db.patch("profiles", deviceProfile._id, { ownerKey: accountKey, updatedAt: Date.now() });
      profileMigrated = true;
    } else if (deviceProfile && accountProfile) {
      const fill: Record<string, unknown> = { updatedAt: Date.now() };
      for (const field of MERGEABLE_PROFILE_FIELDS) {
        if (
          accountProfile[field as keyof typeof accountProfile] === undefined &&
          deviceProfile[field as keyof typeof deviceProfile] !== undefined
        ) {
          fill[field] = deviceProfile[field as keyof typeof deviceProfile];
        }
      }
      await ctx.db.patch("profiles", accountProfile._id, fill);
      await ctx.db.delete("profiles", deviceProfile._id);
      profileMigrated = true;
    }
    let plansMigrated = 0;
    let plansMerged = 0;
    const deviceRows = await ctx.db
      .query("track")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .take(100);
    for (const row of deviceRows) {
      const accountRows = await ctx.db
        .query("track")
        .withIndex("by_device", (q) => q.eq("deviceId", accountKey))
        .take(100);
      const existing = accountRows.find((r) => r.opportunityId === row.opportunityId);
      if (!existing) {
        await ctx.db.patch("track", row._id, { deviceId: accountKey, updatedAt: Date.now() });
        plansMigrated += 1;
        continue;
      }
      const ticked = [...new Set([...existing.ticked, ...row.ticked])].sort((a, b) => a - b);
      const rowRank = PLAN_STATUS_RANK[row.status] ?? 0;
      const existingRank = PLAN_STATUS_RANK[existing.status] ?? 0;
      await ctx.db.patch("track", existing._id, {
        ticked,
        status: rowRank > existingRank ? row.status : existing.status,
        guideCriterionKey: existing.guideCriterionKey ?? row.guideCriterionKey,
        guideTitle: existing.guideTitle ?? row.guideTitle,
        guideDoneAt: Math.max(existing.guideDoneAt ?? 0, row.guideDoneAt ?? 0) || undefined,
        abandonReason: existing.abandonReason ?? row.abandonReason,
        updatedAt: Date.now(),
      });
      await ctx.db.delete("track", row._id);
      plansMerged += 1;
    }
    let threadsMigrated = 0;
    const deviceThreads = await ctx.db
      .query("chatThreads")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .take(50);
    for (const thread of deviceThreads) {
      const accountThreads = await ctx.db
        .query("chatThreads")
        .withIndex("by_device", (q) => q.eq("deviceId", accountKey))
        .take(50);
      const existing = accountThreads.find((r) => r.opportunityId === thread.opportunityId);
      if (!existing) {
        await ctx.db.patch("chatThreads", thread._id, { deviceId: accountKey, updatedAt: Date.now() });
        threadsMigrated += 1;
      } else {
        await ctx.db.delete("chatThreads", thread._id);
        threadsMigrated += 1;
      }
    }
    let answersMigrated = 0;
    const deviceLedger = await ctx.db
      .query("answerLedger")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.deviceId))
      .take(50);
    for (const entry of deviceLedger) {
      const accountEntry = await ctx.db
        .query("answerLedger")
        .withIndex("by_owner_field", (q) => q.eq("ownerKey", accountKey).eq("profileField", entry.profileField))
        .unique();
      if (!accountEntry || entry.confirmedAt > accountEntry.confirmedAt) {
        if (accountEntry) await ctx.db.delete("answerLedger", accountEntry._id);
        await ctx.db.patch("answerLedger", entry._id, { ownerKey: accountKey });
        answersMigrated += 1;
      } else {
        await ctx.db.delete("answerLedger", entry._id);
        answersMigrated += 1;
      }
    }
    const deviceOverrides = await ctx.db
      .query("answerOverrides")
      .withIndex("by_owner_opportunity", (q) => q.eq("ownerKey", args.deviceId))
      .take(100);
    for (const override of deviceOverrides) {
      const accountOverrides = await ctx.db
        .query("answerOverrides")
        .withIndex("by_owner_opportunity", (q) =>
          q.eq("ownerKey", accountKey).eq("opportunityId", override.opportunityId),
        )
        .take(20);
      const existing = accountOverrides.find((r) => r.profileField === override.profileField);
      if (!existing || override.updatedAt > existing.updatedAt) {
        if (existing) await ctx.db.delete("answerOverrides", existing._id);
        await ctx.db.patch("answerOverrides", override._id, { ownerKey: accountKey });
        answersMigrated += 1;
      } else {
        await ctx.db.delete("answerOverrides", override._id);
        answersMigrated += 1;
      }
    }
    let documentsMigrated = 0;
    const deviceDocs = await ctx.db
      .query("userDocuments")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.deviceId))
      .take(50);
    for (const doc of deviceDocs) {
      const accountDocs = await ctx.db
        .query("userDocuments")
        .withIndex("by_owner_type", (q) => q.eq("ownerKey", accountKey).eq("docType", doc.docType))
        .take(10);
      const clash = accountDocs.find(
        (d) =>
          (d.opportunityId ?? null) === (doc.opportunityId ?? null) &&
          (d.criterionKey ?? null) === (doc.criterionKey ?? null),
      );
      if (!clash || doc.updatedAt > clash.updatedAt) {
        if (clash) await ctx.db.delete("userDocuments", clash._id);
        await ctx.db.patch("userDocuments", doc._id, { ownerKey: accountKey });
        documentsMigrated += 1;
      } else {
        await ctx.db.delete("userDocuments", doc._id);
        documentsMigrated += 1;
      }
    }
    let outcomesMigrated = 0;
    const deviceOutcomes = await ctx.db
      .query("planOutcomes")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.deviceId))
      .take(50);
    for (const oc of deviceOutcomes) {
      const accountOutcome = await ctx.db
        .query("planOutcomes")
        .withIndex("by_owner_opp", (q) => q.eq("ownerKey", accountKey).eq("opportunityId", oc.opportunityId))
        .unique();
      if (!accountOutcome || oc.updatedAt > accountOutcome.updatedAt) {
        if (accountOutcome) await ctx.db.delete("planOutcomes", accountOutcome._id);
        await ctx.db.patch("planOutcomes", oc._id, { ownerKey: accountKey });
        outcomesMigrated += 1;
      } else {
        await ctx.db.delete("planOutcomes", oc._id);
        outcomesMigrated += 1;
      }
    }
    return { profileMigrated, plansMigrated, plansMerged, threadsMigrated, answersMigrated, documentsMigrated, outcomesMigrated };
  },
});
