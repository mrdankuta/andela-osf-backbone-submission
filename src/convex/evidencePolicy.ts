import type { Doc } from "./_generated/dataModel";

export type EvidenceSummaryStatus =
  | "fully-supported"
  | "needs-review"
  | "contradicted"
  | "no-evidence";

export type EvidenceSummary = {
  status: EvidenceSummaryStatus;
  supported: number;
  total: number;
};

const CLAIM_TYPE_ORDER: Record<Doc<"opportunityEvidence">["claimType"], number> = {
  benefit: 0,
  applicationStatus: 1,
  deadline: 2,
  eligibility: 3,
  contact: 4,
  officialDestination: 5,
};

export function sortClaims<T extends { claimType: keyof typeof CLAIM_TYPE_ORDER; claimKey: string }>(
  claims: T[],
): T[] {
  return [...claims].sort(
    (a, b) =>
      CLAIM_TYPE_ORDER[a.claimType] - CLAIM_TYPE_ORDER[b.claimType] ||
      a.claimKey.localeCompare(b.claimKey),
  );
}

export function summarizeEvidence(
  claims: ReadonlyArray<{ status: Doc<"opportunityEvidence">["status"] }>,
): EvidenceSummary {
  const total = claims.length;
  const supported = claims.filter((c) => c.status === "supported").length;
  if (total === 0) return { status: "no-evidence", supported, total };
  if (claims.some((c) => c.status === "contradicted")) {
    return { status: "contradicted", supported, total };
  }
  if (claims.some((c) => c.status === "unsupported" || c.status === "pending-review")) {
    return { status: "needs-review", supported, total };
  }
  return { status: "fully-supported", supported, total };
}

export type EvidenceConflict<T = { claimKey: string }> = {
  claimKey: string;
  supported: T[];
  contradicted: T[];
};

/** Material conflicts: the same claim backed AND contradicted by sources.
 *  A lone contradicted row, pending review, or unsupported row is not a
 *  conflict — only the supported-vs-contradicted standoff blocks trust. */
export function findConflicts<T extends { claimKey: string; status: Doc<"opportunityEvidence">["status"] }>(
  rows: ReadonlyArray<T>,
): EvidenceConflict<T>[] {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byKey.get(row.claimKey) ?? [];
    bucket.push(row);
    byKey.set(row.claimKey, bucket);
  }
  const conflicts: EvidenceConflict<T>[] = [];
  for (const [claimKey, group] of byKey) {
    const supported = group.filter((r) => r.status === "supported");
    const contradicted = group.filter((r) => r.status === "contradicted");
    if (supported.length > 0 && contradicted.length > 0) {
      conflicts.push({ claimKey, supported, contradicted });
    }
  }
  return conflicts;
}

export type PassageRelation = "supports" | "contradicts" | "unrelated" | "uncertain";

export type PassageJudgment = { choice: string; confidence: number };

export type PassageJudge = (
  questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>,
  state: Record<string, unknown>,
) => Promise<Record<string, PassageJudgment | undefined>>;

const PASSAGE_QUESTIONS = {
  relation: {
    type: "choice" as const,
    instructions:
      "How does `passage` relate to the claimed fact in `claim`? Quote wording only; do not infer beyond what is written.",
    criteria: {
      supports: "The passage directly states the claimed fact.",
      contradicts: "The passage directly denies or conflicts with the claimed fact.",
      unrelated: "The passage does not address the claimed fact.",
      uncertain: "The relationship cannot be resolved from the wording.",
    },
  },
};

/** Judge how a passage relates to a claimed fact. Without a judge the
 *  outcome is explicitly uncertain — callers must route to a curator. */
export async function judgePassageRelation(
  claim: string,
  passage: string,
  judge?: PassageJudge,
): Promise<{ relation: PassageRelation; confidence: number }> {
  if (!judge) return { relation: "uncertain", confidence: 0 };
  let answers: Record<string, PassageJudgment | undefined>;
  try {
    answers = await judge(PASSAGE_QUESTIONS, { claim, passage });
  } catch {
    return { relation: "uncertain", confidence: 0 };
  }
  const answer = answers.relation;
  if (
    !answer ||
    (answer.choice !== "supports" &&
      answer.choice !== "contradicts" &&
      answer.choice !== "unrelated" &&
      answer.choice !== "uncertain") ||
    answer.confidence < 0.5
  ) {
    return { relation: "uncertain", confidence: 0 };
  }
  return { relation: answer.choice, confidence: answer.confidence };
}
