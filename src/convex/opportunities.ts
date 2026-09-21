import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema, { criterionHardness, criterionOperator, evidenceStatus, profileFactField } from "./schema";
import { compareByDeadline, isPublicOpportunity } from "./catalogPolicy";
import { compareRanked, rankFactors, tierForRank, type RankedRow } from "./rankingPolicy";
import { sortClaims, summarizeEvidence } from "./evidencePolicy";
import {
  composeReadinessWithRoles,
  evaluateHierarchyCriterion,
  resolveCriterionFamily,
  resolveCriterionRole,
  selectEvidence,
} from "./readinessPolicy";
import { alignGuideToGap, guideFreshness } from "./guideMatchPolicy";
import { calculateDeadlineFeasibility, coveredGapKeys, selectPlanningGap } from "./readinessPlanPolicy";
import { collapsedSourceIds } from "./entityLinks";
import { documentState } from "./userDocuments";

const opportunityDoc = schema.doc("opportunities");

const typeArg = v.optional(
  v.union(
    v.literal("grant"),
    v.literal("loan"),
    v.literal("accelerator"),
    v.literal("incubator"),
    v.literal("fellowship"),
    v.literal("gov-program"),
    v.literal("all"),
  ),
);

export const list = query({
  args: {
    type: typeArg,
    search: v.optional(v.string()),
    womenOnly: v.optional(v.boolean()),
    youthOnly: v.optional(v.boolean()),
    state: v.optional(v.string()),
    amountMin: v.optional(v.number()),
    sort: v.optional(v.union(v.literal("deadline"), v.literal("amount"))),
  },
  returns: v.array(opportunityDoc),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("opportunities")
      .withIndex("by_status_and_catalogVisibility", (q) =>
        q.eq("status", "verified").eq("catalogVisibility", "public"),
      )
      .take(50);
    let filtered = results.filter(isPublicOpportunity);
    const collapsed = await collapsedSourceIds(ctx, "program");
    filtered = filtered.filter((o) => !collapsed.has(o._id));
    if (args.search && args.search.length > 1) {
      const s = args.search.toLowerCase();
      filtered = filtered.filter(
        (o) =>
          o.title.toLowerCase().includes(s) || o.providerName.toLowerCase().includes(s),
      );
    }
    if (args.type && args.type !== "all") {
      filtered = filtered.filter((o) => o.type === args.type);
    }
    if (args.womenOnly) filtered = filtered.filter((o) => o.womenOnly);
    if (args.youthOnly) filtered = filtered.filter((o) => o.youthOnly);
    if (args.state && args.state !== "All Nigeria") {
      filtered = filtered.filter(
        (o) => o.locationEligibility === "All Nigeria" || o.locationEligibility.toLowerCase().includes(args.state!.toLowerCase()),
      );
    }
    if (args.amountMin) filtered = filtered.filter((o) => (o.amountValue ?? 0) >= args.amountMin!);
    if (args.sort === "amount") {
      filtered = [...filtered].sort((a, b) => (b.amountValue ?? 0) - (a.amountValue ?? 0));
    } else {
      filtered = [...filtered].sort((a, b) => compareByDeadline(a.deadline, b.deadline));
    }
    return filtered;
  },
});

export const getById = query({
  args: { id: v.id("opportunities") },
  returns: v.union(opportunityDoc, v.null()),
  handler: async (ctx, args) => {
    const o = await ctx.db.get("opportunities", args.id);
    return isPublicOpportunity(o) ? o : null;
  },
});

const evidenceSummaryStatus = v.union(
  v.literal("fully-supported"),
  v.literal("needs-review"),
  v.literal("contradicted"),
  v.literal("no-evidence"),
);

export async function loadEvidenceForOpportunity(ctx: QueryCtx, opportunityId: Id<"opportunities">) {
  const o = await ctx.db.get("opportunities", opportunityId);
  if (!isPublicOpportunity(o)) return null;
  const rows = await ctx.db
    .query("opportunityEvidence")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(50);
  const claims = sortClaims(rows);
  return { summary: summarizeEvidence(claims), claims };
}

export const getEvidence = query({
  args: { id: v.id("opportunities") },
  returns: v.union(
    v.object({
      summary: v.object({
        status: evidenceSummaryStatus,
        supported: v.number(),
        total: v.number(),
      }),
      claims: v.array(schema.doc("opportunityEvidence")),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await loadEvidenceForOpportunity(ctx, args.id);
  },
});

const readinessOverall = v.union(
  v.literal("ready"),
  v.literal("can-become-ready"),
  v.literal("not-currently-eligible"),
  v.literal("needs-information"),
);

const criterionResult = v.union(
  v.literal("met"),
  v.literal("unmet"),
  v.literal("unknown"),
  v.literal("ambiguous"),
  v.literal("needs-evidence"),
);

const readinessAssessment = v.object({
  criterionKey: v.string(),
  label: v.string(),
  profileField: profileFactField,
  profileValue: v.union(v.string(), v.number(), v.boolean(), v.null()),
  requirement: v.string(),
  hardness: criterionHardness,
  result: criterionResult,
  guidance: v.optional(v.string()),
  evidence: v.union(
    v.object({
      claimKey: v.string(),
      status: evidenceStatus,
      sourceUrl: v.string(),
      sourcePassage: v.optional(v.string()),
      note: v.optional(v.string()),
      checkedAt: v.number(),
    }),
    v.null(),
  ),
});

const factArgs = {
  state: v.optional(v.string()),
  sector: v.optional(v.string()),
  businessStage: v.optional(v.string()),
  cac: v.optional(v.string()),
  staffSize: v.optional(v.number()),
  age: v.optional(v.string()),
  womenLed: v.optional(v.boolean()),
  ownerKey: v.optional(v.string()),
};

type FactArgs = {
  state?: string;
  sector?: string;
  businessStage?: string;
  cac?: string;
  staffSize?: number;
  age?: string;
  womenLed?: boolean;
  ownerKey?: string;
};

export async function loadReadiness(ctx: QueryCtx, opportunityId: Id<"opportunities">, args: FactArgs) {
  const [criteria, evidenceRows] = await Promise.all([
    ctx.db
      .query("readinessCriteria")
      .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
      .take(50),
    ctx.db
      .query("opportunityEvidence")
      .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
      .take(50),
  ]);
  const facts: Record<string, string | number | boolean | undefined> = {
    state: args.state,
    sector: args.sector,
    businessStage: args.businessStage,
    cac: args.cac,
    staffSize: args.staffSize,
    age: args.age,
    womenLed: args.womenLed,
  };
  const ordered = [...criteria].sort((a, b) => a.criterionKey.localeCompare(b.criterionKey));
  const needsDocs = args.ownerKey !== undefined && ordered.some(
    (c) => resolveCriterionFamily(c) === "documents" && c.documentType,
  );
  const userDocs = needsDocs
    ? await ctx.db
        .query("userDocuments")
        .withIndex("by_owner", (q) => q.eq("ownerKey", args.ownerKey!))
        .take(50)
    : [];
  const rawResults = ordered.map((criterion) => {
    const evidence = selectEvidence(evidenceRows, criterion.evidenceClaimKey);
    const rawFact = facts[criterion.profileField];
    let result = evaluateHierarchyCriterion(criterion, rawFact, evidence);
    // A stored file is not a satisfied requirement: refine documents-family
    // criteria against the owner's actual document states.
    if (resolveCriterionFamily(criterion) === "documents" && criterion.documentType && args.ownerKey) {
      const doc = userDocs.find((d) => d.docType === criterion.documentType);
      if (!doc) result = "unknown";
      else {
        const state = documentState(doc, Date.now());
        result =
          state === "accepted"
            ? "met"
            : state === "expired"
              ? "unmet"
              : state === "present-unverified"
                ? "needs-evidence"
                : "unknown";
      }
    }
    return { criterion, evidence, rawFact, result };
  });
  const waivers = new Map<string, string>();
  for (const r of rawResults) {
    if (resolveCriterionRole(r.criterion) === "exception" && r.result === "met" && r.criterion.exceptionTo) {
      waivers.set(r.criterion.exceptionTo, r.criterion.label);
    }
  }
  const assessments = rawResults.map(({ criterion, evidence, rawFact, result }) => {
    const waiver = waivers.get(criterion.criterionKey);
    const effective = waiver ? "met" : result;
    const guidance = waiver
      ? `${criterion.guidance ?? criterion.requirement} Waived: ${waiver} applies.`
      : criterion.guidance;
    return {
      criterionKey: criterion.criterionKey,
      label: criterion.label,
      profileField: criterion.profileField,
      profileValue: rawFact ?? null,
      requirement: criterion.requirement,
      hardness: criterion.hardness,
      result: effective,
      guidance,
      evidence: evidence
        ? {
            claimKey: evidence.claimKey,
            status: evidence.status,
            sourceUrl: evidence.sourceUrl,
            sourcePassage: evidence.sourcePassage,
            note: evidence.note,
            checkedAt: evidence.checkedAt,
          }
        : null,
    };
  });
  return {
    overall: composeReadinessWithRoles(
      ordered.map((criterion, i) => ({
        key: criterion.criterionKey,
        role: resolveCriterionRole(criterion),
        hardness: criterion.hardness,
        result: assessments[i].result,
        alternativeGroup: criterion.alternativeGroup,
        exceptionTo: criterion.exceptionTo,
      })),
    ),
    assessments,
  };
}

export const evaluateReadiness = query({
  args: { id: v.id("opportunities"), ...factArgs },
  returns: v.union(
    v.object({ overall: readinessOverall, assessments: v.array(readinessAssessment) }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const o = await ctx.db.get("opportunities", args.id);
    if (!isPublicOpportunity(o)) return null;
    return await loadReadiness(ctx, args.id, args);
  },
});

const INTAKE_FIELD_LABELS: Record<string, string> = {
  state: "State of operation",
  sector: "Business sector",
  businessStage: "Business stage",
  cac: "CAC registration status",
  staffSize: "Number of full-time staff",
  age: "Founder age range",
  womenLed: "Women-owned or women-led",
};

const intakeQuestion = v.object({
  profileField: v.string(),
  label: v.string(),
  kind: v.union(v.literal("boolean"), v.literal("number"), v.literal("select"), v.literal("text")),
  options: v.array(v.string()),
  affects: v.array(
    v.object({ criterionKey: v.string(), label: v.string(), why: v.string() }),
  ),
});

export const intakeQuestions = query({
  args: { id: v.id("opportunities"), ...factArgs },
  returns: v.union(v.object({ questions: v.array(intakeQuestion) }), v.null()),
  handler: async (ctx, args) => {
    const o = await ctx.db.get("opportunities", args.id);
    if (!isPublicOpportunity(o)) return null;
    const [criteria, evidenceRows] = await Promise.all([
      ctx.db
        .query("readinessCriteria")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.id))
        .take(50),
      ctx.db
        .query("opportunityEvidence")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.id))
        .take(50),
    ]);
    const facts: Record<string, string | number | boolean | undefined> = {
      state: args.state,
      sector: args.sector,
      businessStage: args.businessStage,
      cac: args.cac,
      staffSize: args.staffSize,
      age: args.age,
      womenLed: args.womenLed,
    };
    const evaluated = criteria.map((criterion) => ({
      criterion,
      role: resolveCriterionRole(criterion),
      result: evaluateHierarchyCriterion(
        criterion,
        facts[criterion.profileField],
        selectEvidence(evidenceRows, criterion.evidenceClaimKey),
      ),
    }));
    const keys = new Set(criteria.map((c) => c.criterionKey));
    const waived = new Set(
      evaluated
        .filter((e) => e.role === "exception" && e.result === "met" && e.criterion.exceptionTo)
        .map((e) => e.criterion.exceptionTo as string),
    );
    const groupMet = new Set(
      evaluated
        .filter((e) => e.role === "alternative" && e.result === "met" && e.criterion.alternativeGroup)
        .map((e) => e.criterion.alternativeGroup as string),
    );
    const askable = evaluated.filter((e) => {
      if (e.result !== "unknown") return false;
      if (e.role === "informational") return false;
      if (waived.has(e.criterion.criterionKey)) return false;
      if (e.role === "exception") {
        // Ask only when the waiver could unblock its target.
        const target = evaluated.find((t) => t.criterion.criterionKey === e.criterion.exceptionTo);
        return !!target && target.result === "unmet" && keys.has(e.criterion.exceptionTo as string);
      }
      if (e.role === "alternative") {
        return !e.criterion.alternativeGroup || !groupMet.has(e.criterion.alternativeGroup);
      }
      return true;
    });
    const byField = new Map<string, typeof evaluated>();
    for (const e of askable) {
      const bucket = byField.get(e.criterion.profileField) ?? [];
      bucket.push(e);
      byField.set(e.criterion.profileField, bucket);
    }
    const questions = [...byField.entries()].map(([profileField, items]) => {
      const first = items[0];
      const kind =
        profileField === "womenLed"
          ? ("boolean" as const)
          : profileField === "staffSize"
            ? ("number" as const)
            : first.criterion.operator === "at-least" || first.criterion.operator === "at-most"
              ? ("number" as const)
              : first.criterion.expectedValues.length > 0
                ? ("select" as const)
                : ("text" as const);
      const options =
        profileField === "womenLed"
          ? ["Yes", "No"]
          : [...new Set(items.flatMap((e) => e.criterion.expectedValues))];
      return {
        profileField,
        label: INTAKE_FIELD_LABELS[profileField] ?? profileField,
        kind,
        options,
        affects: items.map((e) => ({
          criterionKey: e.criterion.criterionKey,
          label: e.criterion.label,
          why: `${e.criterion.requirement} ${e.criterion.hardness === "hard" ? "This is required — it blocks eligibility until confirmed." : "This unlocks readiness once confirmed."}${e.role === "exception" ? ` Answering could waive ${e.criterion.exceptionTo}.` : ""}`,
        })),
      };
    });
    questions.sort((a, b) => a.profileField.localeCompare(b.profileField));
    return { questions };
  },
});

const planStatus = v.union(
  v.literal("ready"),
  v.literal("actionable"),
  v.literal("blocked"),
  v.literal("needs-information"),
);

const deadlineFeasibility = v.union(
  v.literal("feasible"),
  v.literal("at-risk"),
  v.literal("infeasible"),
  v.literal("unknown"),
);

export const readinessPlanValidator = v.union(
  v.object({
    overall: readinessOverall,
    planStatus,
    gap: v.union(readinessAssessment, v.null()),
    action: v.union(
      v.object({
        title: v.string(),
        detail: v.string(),
        sourceUrl: v.string(),
        expectedDaysMin: v.union(v.number(), v.null()),
        expectedDaysMax: v.union(v.number(), v.null()),
        costEstimate: v.string(),
        dependencies: v.array(v.string()),
        uncertainty: v.string(),
        matchConfidence: v.number(),
        matchNote: v.optional(v.string()),
        stale: v.boolean(),
        lastChecked: v.union(v.number(), v.null()),
        appliesTo: v.array(v.string()),
        prerequisites: v.array(v.string()),
      }),
      v.null(),
    ),
    deadline: v.object({
      status: deadlineFeasibility,
      daysAvailable: v.union(v.number(), v.null()),
    }),
    alternative: v.union(
      v.object({
        title: v.string(),
        detail: v.string(),
        url: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
  }),
  v.null(),
);

export const getReadinessPlan = query({
  args: { id: v.id("opportunities"), ...factArgs, asOf: v.number() },
  returns: readinessPlanValidator,
  handler: async (ctx, args) => {
    return await buildReadinessPlan(ctx, args.id, args);
  },
});

export async function buildReadinessPlan(
  ctx: QueryCtx,
  opportunityId: Id<"opportunities">,
  args: FactArgs & { asOf: number },
) {
  const o = await ctx.db.get("opportunities", opportunityId);
  if (!isPublicOpportunity(o)) return null;
  const { overall, assessments } = await loadReadiness(ctx, opportunityId, args);
  const criteria = await ctx.db
    .query("readinessCriteria")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(50);
  const resultByKey = new Map(assessments.map((a) => [a.criterionKey, a.result]));
  const covered = coveredGapKeys(
    criteria.map((c) => ({
      key: c.criterionKey,
      role: resolveCriterionRole(c),
      result: resultByKey.get(c.criterionKey) ?? "unknown",
      alternativeGroup: c.alternativeGroup,
      exceptionTo: c.exceptionTo,
    })),
  );
  const gap = selectPlanningGap(assessments.filter((a) => !covered.has(a.criterionKey)));
  const unknownDeadline = { status: "unknown" as const, daysAvailable: null };
  if (!gap) {
    return {
      overall,
      planStatus: overall === "ready" ? ("ready" as const) : ("needs-information" as const),
      gap: null,
      action: null,
      deadline: unknownDeadline,
      alternative: null,
    };
  }
  const guides = await ctx.db
    .query("readinessGuides")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(50);
  const criteriaByKey = new Map(criteria.map((c) => [c.criterionKey, c]));
  const match = gap
    ? alignGuideToGap(
        { criterionKey: gap.criterionKey, family: criteriaByKey.get(gap.criterionKey)?.family },
        guides,
        args.state,
      )
    : { outcome: "none" as const, guide: null, confidence: 0 };
  const guide = match.guide;
  const freshness = guide ? guideFreshness(guide, args.asOf) : null;
  const action = guide
    ? {
        title: guide.title,
        detail: guide.detail,
        sourceUrl: guide.sourceUrl,
        expectedDaysMin: guide.expectedDaysMin ?? null,
        expectedDaysMax: guide.expectedDaysMax ?? null,
        costEstimate: guide.costEstimate,
        dependencies: guide.dependencies,
        uncertainty: guide.uncertainty,
        matchConfidence: match.confidence,
        matchNote: match.outcome === "related" ? match.note : undefined,
        stale: freshness?.stale ?? true,
        lastChecked: freshness?.lastChecked ?? null,
        appliesTo: guide.appliesTo ?? [],
        prerequisites: guide.dependencies,
      }
    : null;
  const guideAlternative = guide
    ? {
        title: guide.alternativeTitle,
        detail: guide.alternativeDetail,
        url: guide.alternativeUrl ?? null,
      }
    : null;
  const isHardUnmet = gap.hardness === "hard" && gap.result === "unmet";
  let planStatus: "ready" | "actionable" | "blocked" | "needs-information";
  let alternative: { title: string; detail: string; url: string | null } | null = null;
  let deadline: { status: "feasible" | "at-risk" | "infeasible" | "unknown"; daysAvailable: number | null };
  if (isHardUnmet) {
    planStatus = "blocked";
    deadline =
      guide?.expectedDaysMin !== undefined && guide?.expectedDaysMax !== undefined
        ? calculateDeadlineFeasibility({
            deadline: o.deadline,
            asOf: args.asOf,
            expectedDaysMin: guide.expectedDaysMin,
            expectedDaysMax: guide.expectedDaysMax,
          })
        : unknownDeadline;
    alternative = guideAlternative ?? {
      title: "Compare another opportunity",
      detail:
        "This hard requirement is not currently met. Do not apply unless the official eligibility terms change.",
      url: null,
    };
  } else {
    deadline = calculateDeadlineFeasibility({
      deadline: o.deadline,
      asOf: args.asOf,
      expectedDaysMin: guide?.expectedDaysMin,
      expectedDaysMax: guide?.expectedDaysMax,
    });
    planStatus = gap.result === "ambiguous" ? "needs-information" : guide ? "actionable" : "needs-information";
    if (deadline.status === "infeasible") {
      alternative = guideAlternative ?? {
        title: "Compare another opportunity",
        detail:
          "The published deadline makes this plan infeasible. Review other source-linked opportunities instead.",
        url: null,
      };
    }
  }
  return {
    overall,
    planStatus,
    gap,
    action: isHardUnmet ? null : action,
    deadline,
    alternative,
  };
}

const matchTier = v.union(v.literal("eligible"), v.literal("almost"), v.literal("check"));

export const rankingSnapshot = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      opportunity: opportunityDoc,
      criteria: v.array(
        v.object({
          criterionKey: v.string(),
          label: v.string(),
          requirement: v.string(),
          hardness: criterionHardness,
          profileField: profileFactField,
          operator: criterionOperator,
          expectedValues: v.array(v.string()),
          family: v.optional(v.string()),
          role: v.optional(v.string()),
          alternativeGroup: v.optional(v.string()),
          exceptionTo: v.optional(v.string()),
          evidenceClaimKey: v.string(),
          guidance: v.optional(v.string()),
        }),
      ),
      evidence: v.array(
        v.object({
          _id: v.string(),
          claimKey: v.string(),
          status: evidenceStatus,
          checkedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const all = await ctx.db
      .query("opportunities")
      .withIndex("by_status_and_catalogVisibility", (q) =>
        q.eq("status", "verified").eq("catalogVisibility", "public"),
      )
      .take(50);
    const out = [];
    const collapsed = await collapsedSourceIds(ctx, "program");
    for (const o of all.filter(isPublicOpportunity)) {
      if (collapsed.has(o._id)) continue;
      const criteria = await ctx.db
        .query("readinessCriteria")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", o._id))
        .take(50);
      const evidence = await ctx.db
        .query("opportunityEvidence")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", o._id))
        .take(50);
      out.push({
        opportunity: o,
        criteria: criteria.map((c) => ({
          criterionKey: c.criterionKey,
          label: c.label,
          requirement: c.requirement,
          hardness: c.hardness,
          profileField: c.profileField,
          operator: c.operator,
          expectedValues: c.expectedValues,
          family: c.family,
          role: c.role,
          alternativeGroup: c.alternativeGroup,
          exceptionTo: c.exceptionTo,
          evidenceClaimKey: c.evidenceClaimKey,
          guidance: c.guidance,
        })),
        evidence: evidence.map((e) => ({
          _id: e._id,
          claimKey: e.claimKey,
          status: e.status,
          checkedAt: e.checkedAt,
        })),
      });
    }
    return out;
  },
});

export const matchedOpportunity = opportunityDoc.extend({
  matchTier,
  matchReasons: v.array(v.string()),
  excluded: v.array(v.string()),
  readinessDistance: v.number(),
  unknownCount: v.number(),
  daysAvailable: v.union(v.number(), v.null()),
  fit: v.union(v.literal("high"), v.literal("medium"), v.literal("low"), v.literal("unknown")),
});

export const match = query({
  args: {
    state: v.optional(v.string()),
    sector: v.optional(v.string()),
    cacStatus: v.optional(v.string()),
    womenLed: v.optional(v.boolean()),
    ageRange: v.optional(v.string()),
    needTypes: v.optional(v.array(v.string())),
    asOf: v.optional(v.number()),
  },
  returns: v.array(matchedOpportunity),
  handler: async (ctx, args) => {
    const asOf = args.asOf ?? Date.now();
    const facts = {
      state: args.state,
      sector: args.sector,
      cac: args.cacStatus,
      womenLed: args.womenLed,
      age: args.ageRange,
    };
    const profile = { asOf, womenLed: args.womenLed, needTypes: args.needTypes };
    const all = await ctx.db
      .query("opportunities")
      .withIndex("by_status_and_catalogVisibility", (q) =>
        q.eq("status", "verified").eq("catalogVisibility", "public"),
      )
      .take(50);
    const open = all.filter(isPublicOpportunity);
    const collapsed = await collapsedSourceIds(ctx, "program");
    const visible = open.filter((o) => !collapsed.has(o._id));
    const outputs = [];
    const ranked: RankedRow[] = [];
    for (const o of visible) {
      const { overall, assessments } = await loadReadiness(ctx, o._id, facts);
      const input = {
        id: o._id,
        deadline: o.deadline,
        womenOnly: o.womenOnly,
        type: o.type,
        overall,
        assessments: assessments.map((a) => ({
          key: a.criterionKey,
          label: a.label,
          requirement: a.requirement,
          hardness: a.hardness,
          result: a.result,
        })),
      };
      const factors = rankFactors(input, profile);
      const { tier, reasons } = tierForRank(factors, input, profile);
      outputs.push({
        ...o,
        matchTier: tier,
        matchReasons: reasons,
        excluded: factors.excluded,
        readinessDistance: factors.readinessDistance,
        unknownCount: factors.unknownCount,
        daysAvailable: factors.daysAvailable,
        fit: "unknown" as const,
      });
      ranked.push({ id: o._id, factors, tier, reasons, fit: "unknown" });
    }
    ranked.sort(compareRanked);
    const byId = new Map<string, (typeof outputs)[number]>(outputs.map((o) => [o._id, o]));
    return ranked.map((r) => byId.get(r.id)!);
  },
});
