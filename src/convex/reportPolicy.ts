import type { Doc } from "./_generated/dataModel";

// Community report triage (issue #42).
//
// Reports are categorized at intake and routed by confidence: specific,
// claim-linked reports go to the front of the curator queue; vague ones
// still reach a human, just later. Nothing is ever auto-dismissed.

export const REPORT_CATEGORIES = [
  "broken-source",
  "wrong-deadline",
  "ended-program",
  "suspected-scam",
  "incorrect-eligibility",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  "broken-source": "Link broken",
  "wrong-deadline": "Deadline wrong",
  "ended-program": "Program ended",
  "suspected-scam": "Looks like scam",
  "incorrect-eligibility": "Eligibility wrong",
  other: "Something else",
};

export type ReportPriority = "now" | "queue";
export type RoutingConfidence = "high" | "medium" | "low";

export function routeReport(input: { category: string; claimKey?: string }): {
  priority: ReportPriority;
  confidence: RoutingConfidence;
} {
  const highRisk =
    input.category === "suspected-scam" ||
    input.category === "ended-program" ||
    input.category === "broken-source";
  const confidence: RoutingConfidence = input.claimKey
    ? "high"
    : input.category === "other"
      ? "low"
      : "medium";
  return { priority: highRisk ? "now" : "queue", confidence };
}

export function recheckExpectation(priority: ReportPriority): number {
  return priority === "now" ? 48 : 72;
}

export type FlagDoc = Pick<
  Doc<"flags">,
  "opportunityId" | "reason" | "note" | "status" | "createdAt"
> & {
  category?: string;
  claimKey?: string;
};
