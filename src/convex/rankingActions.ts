"use node";

import { action, env } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { matchedOpportunity } from "./opportunities";
import {
  applyFitToOrder,
  compareRanked,
  rankFactors,
  tierForRank,
  type FitLevel,
  type RankedRow,
} from "./rankingPolicy";
import {
  composeReadinessWithRoles,
  evaluateHierarchyCriterion,
  resolveCriterionRole,
  selectEvidence,
} from "./readinessPolicy";
import { OPENROUTER_DECISIONS_URL, OPENROUTER_JEV_MODEL } from "./profileInterpretation";

const FIT_THRESHOLD = 0.7;
const FIT_TOP_N = 10;
const FIT_TIMEOUT_MS = 20000;

const matchArgs = {
  state: v.optional(v.string()),
  sector: v.optional(v.string()),
  cacStatus: v.optional(v.string()),
  womenLed: v.optional(v.boolean()),
  ageRange: v.optional(v.string()),
  needTypes: v.optional(v.array(v.string())),
  asOf: v.optional(v.number()),
};

type SnapshotCriterion = {
  criterionKey: string;
  label: string;
  requirement: string;
  hardness: "hard" | "remediable";
  profileField: "state" | "sector" | "businessStage" | "cac" | "staffSize" | "age" | "womenLed";
  operator: "equals" | "one-of" | "present" | "at-least" | "at-most";
  expectedValues: string[];
  family?: string;
  role?: string;
  alternativeGroup?: string;
  exceptionTo?: string;
  evidenceClaimKey: string;
  guidance?: string;
};

type SnapshotRow = {
  opportunity: Doc<"opportunities">;
  criteria: SnapshotCriterion[];
  evidence: { _id: string; claimKey: string; status: "supported" | "unsupported" | "contradicted" | "pending-review"; checkedAt: number }[];
};

type RankedOutput = Doc<"opportunities"> & {
  matchTier: "eligible" | "almost" | "check";
  matchReasons: string[];
  excluded: string[];
  readinessDistance: number;
  unknownCount: number;
  daysAvailable: number | null;
  fit: FitLevel;
};

function rankSnapshot(
  snapshot: SnapshotRow[],
  facts: Record<string, string | number | boolean | undefined>,
  profile: { asOf: number; womenLed?: boolean; needTypes?: string[] },
): { outputs: RankedOutput[]; ranked: RankedRow[] } {
  const outputs: RankedOutput[] = [];
  const ranked: RankedRow[] = [];
  for (const row of snapshot) {
    const o = row.opportunity;
    const results = row.criteria.map((criterion) => {
      const evidence = selectEvidence(row.evidence, criterion.evidenceClaimKey);
      return {
        criterion,
        role: resolveCriterionRole(criterion),
        result: evaluateHierarchyCriterion(criterion, facts[criterion.profileField], evidence),
      };
    });
    const overall = composeReadinessWithRoles(
      results.map((r) => ({
        key: r.criterion.criterionKey,
        role: r.role,
        hardness: r.criterion.hardness,
        result: r.result,
        alternativeGroup: r.criterion.alternativeGroup,
        exceptionTo: r.criterion.exceptionTo,
      })),
    );
    const input = {
      id: o._id,
      deadline: o.deadline,
      womenOnly: o.womenOnly,
      type: o.type,
      overall,
      assessments: results.map((r) => ({
        key: r.criterion.criterionKey,
        label: r.criterion.label,
        requirement: r.criterion.requirement,
        hardness: r.criterion.hardness,
        result: r.result,
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
      fit: "unknown",
    });
    ranked.push({ id: o._id, factors, tier, reasons, fit: "unknown" });
  }
  return { outputs, ranked };
}

async function judgeFits(
  items: { id: string; benefit: string; type: string }[],
  profile: { sector?: string; needTypes?: string[] },
): Promise<Record<string, { fit: FitLevel; confidence: number } | undefined>> {
  const fits: Record<string, { fit: FitLevel; confidence: number } | undefined> = {};
  await Promise.all(
    items.map(async (item) => {
      const res = await fetch(OPENROUTER_DECISIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENROUTER_JEV_MODEL,
          state: {
            sector: profile.sector ?? "unstated",
            needs: profile.needTypes?.join(", ") ?? "unstated",
            benefit: item.benefit,
            opportunityType: item.type,
          },
          questions: {
            fit: {
              type: "choice",
              instructions:
                "How well does this opportunity fit the entrepreneur's stated sector and support needs? Judge only the stated sector, needs, benefit, and opportunity type.",
              criteria: {
                high: "The benefit and type directly serve the stated sector and needs.",
                medium: "The benefit partly serves the stated sector or needs.",
                low: "The benefit does not serve the stated sector or needs.",
              },
            },
          },
        }),
        signal: AbortSignal.timeout(FIT_TIMEOUT_MS),
      });
      if (!res.ok) return;
      const data: unknown = await res.json();
      const answers = (data as { answers?: unknown }).answers as
        | Record<string, { type?: unknown; choice?: unknown; confidence?: unknown }>
        | undefined;
      const answer = answers?.fit;
      if (
        answer?.type === "choice" &&
        (answer.choice === "high" || answer.choice === "medium" || answer.choice === "low") &&
        typeof answer.confidence === "number" &&
        Number.isFinite(answer.confidence) &&
        answer.confidence >= 0 &&
        answer.confidence <= 1
      ) {
        fits[item.id] = { fit: answer.choice, confidence: answer.confidence };
      }
    }),
  );
  return fits;
}

export const matchWithFit = action({
  args: matchArgs,
  returns: v.array(matchedOpportunity),
  handler: async (ctx, args): Promise<RankedOutput[]> => {
    const asOf = args.asOf ?? Date.now();
    const facts: Record<string, string | number | boolean | undefined> = {
      state: args.state,
      sector: args.sector,
      cac: args.cacStatus,
      womenLed: args.womenLed,
      age: args.ageRange,
    };
    const profile = { asOf, womenLed: args.womenLed, needTypes: args.needTypes };
    const snapshot = (await ctx.runQuery(
      internal.opportunities.rankingSnapshot,
      {},
    )) as unknown as SnapshotRow[];
    const { outputs, ranked } = rankSnapshot(snapshot, facts, profile);
    ranked.sort(compareRanked);
    const viable = ranked.filter((r) => r.factors.excluded.length === 0).slice(0, FIT_TOP_N);
    if (viable.length > 0 && env.OPENROUTER_API_KEY) {
      try {
        const byId = new Map<string, RankedOutput>(outputs.map((o) => [o._id, o]));
        const fits = await judgeFits(
          viable.map((r) => {
            const o = byId.get(r.id)!;
            return { id: r.id, benefit: o.amountOrBenefit, type: o.type };
          }),
          { sector: args.sector, needTypes: args.needTypes },
        );
        const reranked = applyFitToOrder(ranked, fits, FIT_THRESHOLD);
        ranked.length = 0;
        ranked.push(...reranked);
      } catch (e) {
        console.log(`Fit re-rank skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    const byId = new Map<string, RankedOutput>(outputs.map((o) => [o._id, o]));
    return ranked.map((r) => {
      const o = byId.get(r.id)!;
      return { ...o, fit: r.fit };
    });
  },
});
