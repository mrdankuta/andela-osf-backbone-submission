import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { effectiveOwnerKey } from "./identity";

// Reusable confirmed business answers (issue #50).
//
// A confirmed answer keeps its question, value, confirmation state, and
// update time. Other opportunities propose reuse with visible provenance;
// answering differently for one opportunity writes an override that never
// touches the reusable fact; stale or conflicting answers ask for
// confirmation before use.

export const REUSABLE_FACT_FIELDS = [
  "state",
  "sector",
  "businessStage",
  "cac",
  "staffSize",
  "age",
  "womenLed",
] as const;

export type ReusableFactField = (typeof REUSABLE_FACT_FIELDS)[number];

export const STALE_ANSWER_DAYS = 180;

const factValue = v.union(v.string(), v.number(), v.boolean());

export function coerceFactValue(value: string, valueType: string): string | number | boolean {
  if (valueType === "boolean") return value === "true";
  if (valueType === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

function valueTypeOf(value: string | number | boolean): "string" | "number" | "boolean" {
  return typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
}

export async function recordConfirmedAnswers(
  ctx: MutationCtx,
  ownerKey: string,
  fields: Partial<Record<ReusableFactField, string | number | boolean | undefined>>,
  source: string,
  sourceOpportunityId?: string,
): Promise<void> {
  for (const field of REUSABLE_FACT_FIELDS) {
    const value = fields[field];
    if (value === undefined) continue;
    const existing = await ctx.db
      .query("answerLedger")
      .withIndex("by_owner_field", (q) => q.eq("ownerKey", ownerKey).eq("profileField", field))
      .unique();
    const row = {
      ownerKey,
      profileField: field,
      value: String(value),
      valueType: valueTypeOf(value) as "string" | "number" | "boolean",
      source,
      sourceOpportunityId: sourceOpportunityId as never,
      confirmedAt: Date.now(),
    };
    if (!existing) await ctx.db.insert("answerLedger", row);
    else await ctx.db.patch("answerLedger", existing._id, row);
  }
}

const provenanceEntry = v.object({
  field: v.string(),
  displayValue: v.string(),
  source: v.string(),
  sourceLabel: v.string(),
  confirmedAt: v.number(),
  stale: v.boolean(),
  overridden: v.boolean(),
});

async function sourceLabel(
  ctx: QueryCtx,
  source: string,
  sourceOpportunityId?: string,
): Promise<string> {
  if (source === "override" && sourceOpportunityId) {
    const opp = await ctx.db.get("opportunities", sourceOpportunityId as never);
    return opp ? `This opportunity (${opp.title})` : "This opportunity";
  }
  if (sourceOpportunityId) {
    const opp = await ctx.db.get("opportunities", sourceOpportunityId as never);
    if (opp) return `${opp.title} intake`;
  }
  if (source === "onboarding") return "Onboarding";
  if (source === "profile") return "Profile settings";
  if (source === "intake") return "Readiness intake";
  return source;
}

export type ProvenanceEntry = {
  field: string;
  displayValue: string;
  source: string;
  sourceLabel: string;
  confirmedAt: number;
  stale: boolean;
  overridden: boolean;
};

export async function readAnswerProvenance(
  ctx: QueryCtx,
  ownerKey: string,
  opportunityId?: Id<"opportunities">,
): Promise<ProvenanceEntry[]> {
    const entries = await ctx.db
      .query("answerLedger")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .take(50);
    const overrides = opportunityId
      ? await ctx.db
          .query("answerOverrides")
          .withIndex("by_owner_opportunity", (q) =>
            q.eq("ownerKey", ownerKey).eq("opportunityId", opportunityId!),
          )
          .take(20)
      : [];
    const byField = new Map(overrides.map((o) => [o.profileField, o]));
    const out = [];
    const now = Date.now();
    for (const e of entries) {
      const override = byField.get(e.profileField);
      const stale = now - e.confirmedAt > STALE_ANSWER_DAYS * 86400000;
      if (override) {
        out.push({
          field: e.profileField,
          displayValue: override.value,
          source: "override",
          sourceLabel: await sourceLabel(ctx, "override", opportunityId),
          confirmedAt: override.updatedAt,
          stale: now - override.updatedAt > STALE_ANSWER_DAYS * 86400000,
          overridden: true,
        });
      }
      out.push({
        field: e.profileField,
        displayValue: e.value,
        source: e.source,
        sourceLabel: await sourceLabel(ctx, e.source, e.sourceOpportunityId),
        confirmedAt: e.confirmedAt,
        stale,
        overridden: false,
      });
    }
    return out;
}

export const answerProvenance = query({
  args: { ownerKey: v.string(), opportunityId: v.optional(v.id("opportunities")) },
  returns: v.array(provenanceEntry),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    return await readAnswerProvenance(ctx, ownerKey, args.opportunityId);
  },
});

export const effectiveFacts = query({
  args: { ownerKey: v.string(), opportunityId: v.optional(v.id("opportunities")) },
  returns: v.object({
    state: v.optional(v.string()),
    sector: v.optional(v.string()),
    businessStage: v.optional(v.string()),
    cac: v.optional(v.string()),
    staffSize: v.optional(v.number()),
    age: v.optional(v.string()),
    womenLed: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .unique();
    const facts: Record<string, string | number | boolean | undefined> = {
      state: profile?.state,
      sector: profile?.sector,
      businessStage: profile?.businessStage,
      cac: profile?.cac,
      staffSize: profile?.staffSize,
      age: profile?.age,
      womenLed: profile?.womenLed,
    };
    if (args.opportunityId) {
      const overrides = await ctx.db
        .query("answerOverrides")
        .withIndex("by_owner_opportunity", (q) =>
          q.eq("ownerKey", ownerKey).eq("opportunityId", args.opportunityId!),
        )
        .take(20);
      for (const o of overrides) {
        facts[o.profileField] = coerceFactValue(o.value, o.valueType);
      }
    }
    return facts;
  },
});

export const setAnswerOverride = mutation({
  args: {
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    profileField: v.string(),
    value: v.string(),
    valueType: v.union(v.literal("string"), v.literal("number"), v.literal("boolean")),
  },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    if (!(REUSABLE_FACT_FIELDS as readonly string[]).includes(args.profileField)) {
      throw new Error("Only readiness facts can be overridden.");
    }
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    const existing = await ctx.db
      .query("answerOverrides")
      .withIndex("by_owner_opportunity", (q) => q.eq("ownerKey", ownerKey).eq("opportunityId", args.opportunityId))
      .take(20);
    const hit = existing.find((r) => r.profileField === args.profileField);
    if (hit) {
      await ctx.db.patch("answerOverrides", hit._id, {
        value: args.value,
        valueType: args.valueType,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("answerOverrides", {
        ownerKey,
        opportunityId: args.opportunityId,
        profileField: args.profileField,
        value: args.value,
        valueType: args.valueType,
        updatedAt: Date.now(),
      });
    }
    return true as const;
  },
});

export const clearAnswerOverride = mutation({
  args: { ownerKey: v.string(), opportunityId: v.id("opportunities"), profileField: v.string() },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const existing = await ctx.db
      .query("answerOverrides")
      .withIndex("by_owner_opportunity", (q) => q.eq("ownerKey", ownerKey).eq("opportunityId", args.opportunityId))
      .take(20);
    const hit = existing.find((r) => r.profileField === args.profileField);
    if (!hit) return null;
    await ctx.db.delete("answerOverrides", hit._id);
    return true as const;
  },
});
