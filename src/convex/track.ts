import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { isPublicOpportunity } from "./catalogPolicy";
import { effectiveOwnerKey } from "./identity";
import { buildReadinessPlan } from "./opportunities";

// Plan states: qualifying → ready → applying → applied, with abandoned as a
// recorded exit. Legacy saved/in-progress rows keep working by mapping onto
// the current states on read; new writes use current states only.
const LEGACY_STATE_MAP: Record<string, "qualifying" | "ready" | "applying" | "applied" | "abandoned"> = {
  saved: "qualifying",
  "in-progress": "applying",
  applied: "applied",
  qualifying: "qualifying",
  ready: "ready",
  applying: "applying",
  abandoned: "abandoned",
};

export function displayPlanState(status: string): "qualifying" | "ready" | "applying" | "applied" | "abandoned" {
  return LEGACY_STATE_MAP[status] ?? "qualifying";
}

export const PLAN_TRANSITIONS: Record<string, string[]> = {
  qualifying: ["ready", "applying", "abandoned"],
  ready: ["applying", "abandoned", "qualifying"],
  applying: ["applied", "abandoned", "ready"],
  applied: [],
  abandoned: ["qualifying"],
};

const planFactArgs = {
  state: v.optional(v.string()),
  sector: v.optional(v.string()),
  businessStage: v.optional(v.string()),
  cac: v.optional(v.string()),
  staffSize: v.optional(v.number()),
  age: v.optional(v.string()),
  womenLed: v.optional(v.boolean()),
};

const planState = v.union(
  v.literal("qualifying"),
  v.literal("ready"),
  v.literal("applying"),
  v.literal("applied"),
  v.literal("abandoned"),
);

export type PlanListFacts = {
  state?: string;
  sector?: string;
  businessStage?: string;
  cac?: string;
  staffSize?: number;
  age?: string;
  womenLed?: boolean;
};

/** Shared plan-row assembly for owners and consented advisers. */
export async function listPlansForOwner(
  ctx: QueryCtx,
  ownerKey: string,
  facts: PlanListFacts = {},
  asOf: number = Date.now(),
) {
  const rows = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", ownerKey)).take(50);
  const out = [];
  for (const r of rows) {
    const opp = await ctx.db.get("opportunities", r.opportunityId);
    if (!isPublicOpportunity(opp)) continue;
    const total = opp.steps.length || 1;
    const pct = Math.round((r.ticked.length / total) * 100);
    const next = opp.steps.find((s) => !r.ticked.includes(s.order));
    const plan = await buildReadinessPlan(ctx, r.opportunityId, { ...facts, asOf });
    const overdue = opp.deadline !== undefined && opp.deadline < asOf;
    const risk = overdue
      ? ("overdue" as const)
      : !plan
        ? ("unknown" as const)
        : plan.deadline.status === "feasible"
          ? ("on-track" as const)
          : plan.deadline.status === "at-risk"
            ? ("at-risk" as const)
            : plan.deadline.status === "infeasible"
              ? ("infeasible" as const)
              : ("unknown" as const);
    out.push({
      ...r,
      opportunity: opp,
      progress: pct,
      nextStep: next?.title ?? "All done",
      displayState: displayPlanState(r.status),
      readinessOverall: plan?.overall ?? null,
      nextDependency: plan?.gap
        ? { label: plan.gap.label, guidance: plan.gap.guidance ?? plan.gap.requirement }
        : null,
      deadlineRisk: risk,
    });
  }
  return out;
}

export const list = query({
  args: { deviceId: v.string(), facts: v.optional(v.object(planFactArgs)), asOf: v.optional(v.number()) },
  returns: v.array(
    schema.doc("track").extend({
      opportunity: schema.doc("opportunities"),
      progress: v.number(),
      nextStep: v.string(),
      displayState: planState,
      readinessOverall: v.union(
        v.literal("ready"),
        v.literal("can-become-ready"),
        v.literal("not-currently-eligible"),
        v.literal("needs-information"),
        v.null(),
      ),
      nextDependency: v.union(
        v.object({ label: v.string(), guidance: v.string() }),
        v.null(),
      ),
      deadlineRisk: v.union(
        v.literal("on-track"),
        v.literal("at-risk"),
        v.literal("infeasible"),
        v.literal("overdue"),
        v.literal("unknown"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const deviceId = await effectiveOwnerKey(ctx, args.deviceId);
    return await listPlansForOwner(ctx, deviceId, args.facts ?? {}, args.asOf ?? Date.now());
  },
});

export const save = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    deviceId: v.string(),
    guideCriterionKey: v.optional(v.string()),
    guideTitle: v.optional(v.string()),
  },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const deviceId = await effectiveOwnerKey(ctx, args.deviceId);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) throw new Error("Opportunity unavailable.");
    const existing = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).take(50);
    const found = existing.find((r) => r.opportunityId === args.opportunityId);
    if (found) {
      if (
        (args.guideCriterionKey && found.guideCriterionKey !== args.guideCriterionKey) ||
        (args.guideTitle && found.guideTitle !== args.guideTitle)
      ) {
        await ctx.db.patch("track", found._id, {
          guideCriterionKey: args.guideCriterionKey,
          guideTitle: args.guideTitle,
          updatedAt: Date.now(),
        });
        return true;
      }
      return null;
    }
    await ctx.db.insert("track", {
      opportunityId: args.opportunityId,
      deviceId: deviceId,
      ticked: [],
      status: "qualifying",
      updatedAt: Date.now(),
      guideCriterionKey: args.guideCriterionKey,
      guideTitle: args.guideTitle,
    });
    return true;
  },
});

export const tick = mutation({
  args: { opportunityId: v.id("opportunities"), deviceId: v.string(), step: v.number() },
  returns: v.array(v.number()),
  handler: async (ctx, args) => {
    const deviceId = await effectiveOwnerKey(ctx, args.deviceId);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) throw new Error("Opportunity unavailable.");
    const rows = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).take(50);
    let row = rows.find((r) => r.opportunityId === args.opportunityId);
    if (!row) {
      await ctx.db.insert("track", { opportunityId: args.opportunityId, deviceId: deviceId, ticked: [args.step], status: "applying", updatedAt: Date.now() });
      return [args.step];
    }
    const set = new Set(row.ticked);
    if (set.has(args.step)) set.delete(args.step);
    else set.add(args.step);
    const ticked = [...set];
    await ctx.db.patch("track", row._id, { ticked, status: ticked.length > 0 ? "applying" : "qualifying", updatedAt: Date.now() });
    return ticked;
  },
});

export const setPlanState = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    deviceId: v.string(),
    state: planState,
    abandonReason: v.optional(v.string()),
  },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const deviceId = await effectiveOwnerKey(ctx, args.deviceId);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) throw new Error("Opportunity unavailable.");
    if (args.state === "abandoned" && !args.abandonReason?.trim()) {
      throw new Error("Tell us why in one line — it helps improve matching.");
    }
    const rows = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).take(50);
    let row = rows.find((r) => r.opportunityId === args.opportunityId);
    if (!row) {
      const created = await ctx.db.insert("track", {
        opportunityId: args.opportunityId,
        deviceId: deviceId,
        ticked: [],
        status: "qualifying" as const,
        updatedAt: Date.now(),
      });
      row = (await ctx.db.get("track", created)) ?? undefined;
    }
    if (!row) return null;
    const current = displayPlanState(row.status);
    if (current !== args.state && !(PLAN_TRANSITIONS[current] ?? []).includes(args.state)) {
      throw new Error(`Cannot move from ${current} to ${args.state}.`);
    }
    await ctx.db.patch("track", row._id, {
      status: args.state,
      abandonReason: args.state === "abandoned" ? args.abandonReason?.trim() : undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const completeGuide = mutation({
  args: { opportunityId: v.id("opportunities"), deviceId: v.string() },
  returns: v.object({ guideDoneAt: v.number(), ticksPreserved: v.number() }),
  handler: async (ctx, args) => {
    const deviceId = await effectiveOwnerKey(ctx, args.deviceId);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) throw new Error("Opportunity unavailable.");
    const rows = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).take(50);
    const row = rows.find((r) => r.opportunityId === args.opportunityId);
    if (!row) throw new Error("Save this opportunity before completing its guide.");
    const guideDoneAt = Date.now();
    await ctx.db.patch("track", row._id, { guideDoneAt, updatedAt: guideDoneAt });
    return { guideDoneAt, ticksPreserved: row.ticked.length };
  },
});

export const markApplied = mutation({
  args: { opportunityId: v.id("opportunities"), deviceId: v.string() },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const deviceId = await effectiveOwnerKey(ctx, args.deviceId);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) throw new Error("Opportunity unavailable.");
    const rows = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).take(50);
    const row = rows.find((r) => r.opportunityId === args.opportunityId);
    if (!row) return null;
    await ctx.db.patch("track", row._id, { status: "applied", updatedAt: Date.now() });
    return true;
  },
});

export const remove = mutation({
  args: { opportunityId: v.id("opportunities"), deviceId: v.string() },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const deviceId = await effectiveOwnerKey(ctx, args.deviceId);
    const rows = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).take(50);
    const row = rows.find((r) => r.opportunityId === args.opportunityId);
    if (!row) return null;
    await ctx.db.delete("track", row._id);
    return true;
  },
});
