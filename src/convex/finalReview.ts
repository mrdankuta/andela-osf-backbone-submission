import { query } from "./_generated/server";
import { v } from "convex/values";
import { isPublicOpportunity } from "./catalogPolicy";
import { effectiveOwnerKey } from "./identity";
import { loadReadiness } from "./opportunities";
import { buildReadinessPlan } from "./opportunities";
import { resolveCriterionRole } from "./readinessPolicy";
import { documentState } from "./userDocuments";
import { readFreshness } from "./sourceMonitor";

// Final pre-application review (issue #57).
//
// One consolidated checklist before the entrepreneur leaves for the
// official portal: mandatory criteria, confirmed facts, required
// documents, unresolved issues, stale evidence, deadline risk, and the
// verified official destination. Continuing records an applying state
// through the existing plan machine — Backbone never claims submission,
// and the provider stays the final authority.

const URGENT_DEADLINE_DAYS = 7;

export const finalReview = query({
  args: {
    id: v.id("opportunities"),
    ownerKey: v.optional(v.string()),
    state: v.optional(v.string()),
    sector: v.optional(v.string()),
    businessStage: v.optional(v.string()),
    cac: v.optional(v.string()),
    staffSize: v.optional(v.number()),
    age: v.optional(v.string()),
    womenLed: v.optional(v.boolean()),
    asOf: v.optional(v.number()),
  },
  returns: v.union(
    v.object({
      overall: v.string(),
      planStatus: v.string(),
      mandatory: v.array(
        v.object({
          criterionKey: v.string(),
          label: v.string(),
          result: v.string(),
          profileValue: v.union(v.string(), v.number(), v.boolean(), v.null()),
          requirement: v.string(),
        }),
      ),
      confirmedFacts: v.array(v.object({ field: v.string(), value: v.string() })),
      documents: v.array(
        v.object({
          criterionKey: v.string(),
          label: v.string(),
          state: v.string(),
          documentId: v.union(v.string(), v.null()),
        }),
      ),
      unresolved: v.array(v.object({ kind: v.string(), label: v.string(), detail: v.string() })),
      deadline: v.object({
        status: v.string(),
        daysAvailable: v.union(v.number(), v.null()),
        date: v.union(v.string(), v.null()),
        urgent: v.boolean(),
      }),
      freshness: v.object({
        state: v.union(
          v.literal("ok"),
          v.literal("stale"),
          v.literal("unavailable"),
          v.literal("under-review"),
          v.literal("closed"),
        ),
        lastChecked: v.union(v.number(), v.null()),
      }),
      destination: v.object({ url: v.string(), verified: v.boolean() }),
      blockers: v.array(v.string()),
      canContinue: v.boolean(),
      authorityNote: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const o = await ctx.db.get("opportunities", args.id);
    if (!isPublicOpportunity(o)) return null;
    const asOf = args.asOf ?? Date.now();
    const factOwner = args.ownerKey ? await effectiveOwnerKey(ctx, args.ownerKey) : undefined;
    const facts = {
      state: args.state,
      sector: args.sector,
      businessStage: args.businessStage,
      cac: args.cac,
      staffSize: args.staffSize,
      age: args.age,
      womenLed: args.womenLed,
      ownerKey: factOwner,
    };
    const { overall, assessments } = await loadReadiness(ctx, args.id, facts);
    const plan = await buildReadinessPlan(ctx, args.id, { ...facts, asOf });
    if (!plan) return null;
    const criteria = await ctx.db
      .query("readinessCriteria")
      .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.id))
      .take(50);
    const mandatory = assessments
      .filter((a) => {
        const doc = criteria.find((c) => c.criterionKey === a.criterionKey);
        return resolveCriterionRole(doc ?? { role: undefined, hardness: a.hardness }) === "mandatory";
      })
      .map((a) => ({
        criterionKey: a.criterionKey,
        label: a.label,
        result: a.result,
        profileValue: a.profileValue,
        requirement: a.requirement,
      }));
    const confirmedFacts = Object.entries({
      state: args.state,
      sector: args.sector,
      businessStage: args.businessStage,
      cac: args.cac,
      staffSize: args.staffSize,
      age: args.age,
      womenLed: args.womenLed,
    })
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({ field, value: String(value) }));
    let documents: { criterionKey: string; label: string; state: string; documentId: string | null }[] = [];
    const docOwner = args.ownerKey ? await effectiveOwnerKey(ctx, args.ownerKey) : undefined;
    const docs = docOwner
      ? await ctx.db
          .query("userDocuments")
          .withIndex("by_owner", (q) => q.eq("ownerKey", docOwner))
          .take(50)
      : [];
    documents = criteria
      .filter((c) => (c.family ?? "") === "documents" && c.documentType)
      .map((c) => {
        const doc = docs.find((d) => d.docType === c.documentType);
        return {
          criterionKey: c.criterionKey,
          label: c.label,
          state: documentState(doc ?? null, asOf),
          documentId: doc?._id ?? null,
        };
      });
    const unresolved: { kind: string; label: string; detail: string }[] = [];
    for (const a of assessments) {
      if (a.result === "unknown" || a.result === "ambiguous" || a.result === "needs-evidence") {
        unresolved.push({
          kind: "criterion",
          label: a.label,
          detail: a.guidance ?? a.requirement,
        });
      }
    }
    for (const d of documents) {
      if (d.state !== "accepted") {
        unresolved.push({
          kind: "document",
          label: d.label,
          detail:
            d.state === "missing"
              ? "No file uploaded yet."
              : d.state === "expired"
                ? "The uploaded file has expired — replace it."
                : "Uploaded, awaiting curator check.",
        });
      }
    }
    const freshness =
      (await readFreshness(ctx, args.id)) ?? ({ state: "ok" as const, lastChecked: null });
    if (freshness.state === "stale" || freshness.state === "unavailable" || freshness.state === "under-review") {
      unresolved.push({
        kind: "evidence",
        label: "Source freshness",
        detail:
          freshness.state === "stale"
            ? "The official page changed since verification."
            : freshness.state === "unavailable"
              ? "The official page could not be reached."
              : "Curators are re-checking this listing.",
      });
    }
    const urgent =
      plan.deadline.daysAvailable !== null &&
      plan.deadline.daysAvailable <= URGENT_DEADLINE_DAYS &&
      plan.deadline.status !== "unknown";
    const blockers: string[] = [];
    if (plan.planStatus === "blocked") blockers.push("A hard requirement is not met.");
    if (plan.deadline.status === "infeasible") blockers.push("The deadline makes this plan infeasible.");
    if (o.status === "expired") blockers.push("This opportunity has closed.");
    let destinationUrl = o.contacts.officialLink;
    let destinationVerified = false;
    try {
      const parsed = new URL(destinationUrl);
      destinationVerified = parsed.protocol === "https:";
    } catch {
      destinationUrl = o.sourceUrl;
      destinationVerified = false;
    }
    return {
      overall,
      planStatus: plan.planStatus,
      mandatory,
      confirmedFacts,
      documents,
      unresolved,
      deadline: {
        status: plan.deadline.status,
        daysAvailable: plan.deadline.daysAvailable,
        date: o.deadline === undefined ? null : new Date(o.deadline).toLocaleDateString(),
        urgent,
      },
      freshness,
      destination: { url: destinationUrl, verified: destinationVerified },
      blockers,
      canContinue: blockers.length === 0,
      authorityNote: `${o.providerName} decides who gets funded — Backbone guides, never submits. Your application happens on their portal.`,
    };
  },
});
