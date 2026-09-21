import type { Doc } from "./_generated/dataModel";
import type { CriterionResult } from "./readinessPolicy";

export type DeadlineFeasibility = "feasible" | "at-risk" | "infeasible" | "unknown";

export type DeadlineAssessment = {
  status: DeadlineFeasibility;
  daysAvailable: number | null;
};

export function calculateDeadlineFeasibility(args: {
  deadline?: number;
  asOf: number;
  expectedDaysMin?: number;
  expectedDaysMax?: number;
}): DeadlineAssessment {
  const { deadline, asOf, expectedDaysMin, expectedDaysMax } = args;
  if (!Number.isFinite(asOf)) return { status: "unknown", daysAvailable: null };
  if (deadline === undefined) return { status: "unknown", daysAvailable: null };
  const daysAvailable = Math.max(0, Math.floor((deadline - asOf) / 86400000));
  const min = expectedDaysMin;
  const max = expectedDaysMax;
  const estimatesValid =
    min !== undefined &&
    max !== undefined &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min >= 0 &&
    max >= 0 &&
    min <= max;
  if (!estimatesValid) return { status: "unknown", daysAvailable };
  if (deadline <= asOf) return { status: "infeasible", daysAvailable };
  if (max <= daysAvailable) return { status: "feasible", daysAvailable };
  if (min > daysAvailable) return { status: "infeasible", daysAvailable };
  return { status: "at-risk", daysAvailable };
}

type GapCandidate = {
  criterionKey: string;
  hardness: Doc<"readinessCriteria">["hardness"];
  result: CriterionResult;
};

export type GapInput = {
  key: string;
  role: string;
  result: CriterionResult;
  alternativeGroup?: string;
  exceptionTo?: string;
};

/** Keys that must never become the plan gap: informational and exception
 *  clauses, waived targets, and members of a satisfied alternative group.
 *  Unmet or uncertain group members stay actionable. */
export function coveredGapKeys(items: GapInput[]): Set<string> {
  const covered = new Set<string>();
  const keys = new Set(items.map((i) => i.key));
  for (const i of items) {
    if (i.role === "informational" || i.role === "exception") covered.add(i.key);
    if (i.role === "exception" && i.result === "met" && i.exceptionTo && keys.has(i.exceptionTo)) {
      covered.add(i.exceptionTo);
    }
  }
  const groups = new Map<string, CriterionResult[]>();
  for (const i of items) {
    if (i.role !== "alternative" || !i.alternativeGroup) continue;
    const bucket = groups.get(i.alternativeGroup) ?? [];
    bucket.push(i.result);
    groups.set(i.alternativeGroup, bucket);
  }
  for (const [group, results] of groups) {
    if (!results.includes("met")) continue;
    for (const i of items) {
      if (i.role === "alternative" && i.alternativeGroup === group) covered.add(i.key);
    }
  }
  return covered;
}

function gapPriority(a: GapCandidate): number {
  if (a.hardness === "hard" && a.result === "unmet") return 0;
  if (a.result === "ambiguous") return 1;
  if (a.hardness === "remediable" && a.result === "unmet") return 2;
  if (a.result === "needs-evidence") return 3;
  if (a.result === "unknown") return 4;
  return 5;
}

export function selectPlanningGap<T extends GapCandidate>(assessments: T[]): T | undefined {
  return [...assessments]
    .filter((a) => gapPriority(a) < 5)
    .sort(
      (a, b) => gapPriority(a) - gapPriority(b) || a.criterionKey.localeCompare(b.criterionKey),
    )[0];
}
