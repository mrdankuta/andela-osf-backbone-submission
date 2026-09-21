import type { CriterionResult, ReadinessOverall } from "./readinessPolicy";

// Deterministic opportunity ranking (issue #38).
//
// Stage 1 — hard gates: expired, hard-unmet (unwaived), and untrusted rows
// are excluded with reasons. Soft signals can never promote them.
// Stage 2 — deterministic order: readiness distance, then unknown count,
// then days available, then id (stable ties). No percentages, no vibes.
// Stage 3 — bounded semantic fit (matchWithFit action): re-ranks viable
// rows only; excluded rows are untouched and ambiguous fit keeps position.

export type FitLevel = "high" | "medium" | "low" | "unknown";

export type RankFactors = {
  excluded: string[];
  readinessDistance: number;
  unknownCount: number;
  daysAvailable: number | null;
  overall: ReadinessOverall;
};

export type RankAssessment = {
  key: string;
  label: string;
  requirement: string;
  hardness: "hard" | "remediable";
  result: CriterionResult;
};

export type RankInput = {
  id: string;
  deadline?: number;
  womenOnly?: boolean;
  type: string;
  overall: ReadinessOverall;
  assessments: RankAssessment[];
};

export type RankProfile = {
  asOf: number;
  womenLed?: boolean;
  needTypes?: string[];
};

export function rankFactors(input: RankInput, profile: RankProfile): RankFactors {
  const excluded: string[] = [];
  if (input.deadline !== undefined && input.deadline < profile.asOf) {
    excluded.push("Applications closed — the deadline has passed.");
  }
  const hardUnmet = input.assessments.filter((a) => a.hardness === "hard" && a.result === "unmet");
  for (const a of hardUnmet) excluded.push(`Not eligible: ${a.label}.`);
  const unmet = input.assessments.filter((a) => a.result === "unmet").length;
  const unknown = input.assessments.filter(
    (a) => a.result === "unknown" || a.result === "needs-evidence" || a.result === "ambiguous",
  ).length;
  const daysAvailable =
    input.deadline === undefined ? null : Math.max(0, Math.floor((input.deadline - profile.asOf) / 86400000));
  return {
    excluded,
    readinessDistance: unmet + unknown,
    unknownCount: unknown,
    daysAvailable,
    overall: input.overall,
  };
}

export type MatchTier = "eligible" | "almost" | "check";

export function tierForRank(
  factors: RankFactors,
  input: RankInput,
  profile: RankProfile,
): { tier: MatchTier; reasons: string[] } {
  if (input.womenOnly === true && profile.womenLed !== true) {
    return { tier: "check", reasons: ["Women-owned businesses only"] };
  }
  if (factors.excluded.length > 0) return { tier: "check", reasons: [...factors.excluded] };
  const reasons: string[] = [];
  const needHit = profile.needTypes?.includes(input.type) ?? false;
  if (needHit) reasons.push(`Matches your ${input.type} need`);
  if (factors.overall === "ready") {
    reasons.push("All eligibility criteria met");
    if (factors.daysAvailable !== null) reasons.push(`${factors.daysAvailable} days left to apply`);
    else reasons.push("No deadline published — confirm timing on the portal");
    return { tier: "eligible", reasons };
  }
  if (factors.overall === "can-become-ready") {
    for (const a of input.assessments) {
      if (a.result === "unmet") reasons.push(`Next: ${a.label}`);
      else if (a.result === "unknown") reasons.push(`Needs: ${a.label}`);
    }
    return { tier: "almost", reasons };
  }
  // needs-information: distinguish missing user facts from pending verification.
  const unknownHard = input.assessments.filter((a) => a.result === "unknown" && a.hardness === "hard");
  for (const a of input.assessments) {
    if (a.result === "unknown") reasons.push(`Needs: ${a.label}`);
    else if (a.result === "needs-evidence" || a.result === "ambiguous") reasons.push(`Verifying: ${a.label}`);
  }
  if (unknownHard.length > 0) return { tier: "check", reasons };
  if (input.assessments.every((a) => a.result !== "unknown")) {
    reasons.push("Your answers are complete — verification pending");
    return { tier: "eligible", reasons };
  }
  return { tier: "almost", reasons };
}

export type RankedRow = {
  id: string;
  factors: RankFactors;
  tier: MatchTier;
  reasons: string[];
  fit: FitLevel;
};

const FIT_RANK: Record<FitLevel, number> = { high: 0, medium: 1, low: 2, unknown: 3 };

/** Deterministic order: viable first, then distance, unknowns, deadline, id. */
export function compareRanked(a: RankedRow, b: RankedRow): number {
  const aExcluded = a.factors.excluded.length > 0 ? 1 : 0;
  const bExcluded = b.factors.excluded.length > 0 ? 1 : 0;
  if (aExcluded !== bExcluded) return aExcluded - bExcluded;
  if (a.factors.readinessDistance !== b.factors.readinessDistance) {
    return a.factors.readinessDistance - b.factors.readinessDistance;
  }
  if (a.factors.unknownCount !== b.factors.unknownCount) {
    return a.factors.unknownCount - b.factors.unknownCount;
  }
  const aDays = a.factors.daysAvailable ?? Number.MAX_SAFE_INTEGER;
  const bDays = b.factors.daysAvailable ?? Number.MAX_SAFE_INTEGER;
  if (aDays !== bDays) return aDays - bDays;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Stage 3: bounded semantic re-rank of viable rows only. Excluded rows never
 *  move; unknown/ambiguous fit keeps the deterministic position (stable). */
export function applyFitToOrder(
  rows: RankedRow[],
  fits: Record<string, { fit: FitLevel; confidence: number } | undefined>,
  threshold = 0.7,
): RankedRow[] {
  const viable = rows.filter((r) => r.factors.excluded.length === 0);
  const excluded = rows.filter((r) => r.factors.excluded.length !== 0);
  const reranked = viable
    .map((r, i) => {
      const judged = fits[r.id];
      const fit: FitLevel =
        judged && judged.confidence >= threshold && (judged.fit === "high" || judged.fit === "medium" || judged.fit === "low")
          ? judged.fit
          : "unknown";
      return { row: { ...r, fit }, fitRank: FIT_RANK[fit], index: i };
    })
    .sort((a, b) => a.fitRank - b.fitRank || a.index - b.index)
    .map((e) => e.row);
  return [...reranked, ...excluded];
}
