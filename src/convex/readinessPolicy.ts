import type { Doc } from "./_generated/dataModel";

export type CriterionResult =
  | "met"
  | "unmet"
  | "unknown"
  | "ambiguous"
  | "needs-evidence";

export type ReadinessOverall =
  | "ready"
  | "can-become-ready"
  | "not-currently-eligible"
  | "needs-information";

export type CriterionAssessment = {
  criterion: Doc<"readinessCriteria">;
  result: CriterionResult;
};

type EvidenceLike = { status: Doc<"opportunityEvidence">["status"] } | undefined;

const EVIDENCE_STATUS_PRECEDENCE: Record<Doc<"opportunityEvidence">["status"], number> = {
  contradicted: 0,
  unsupported: 1,
  "pending-review": 2,
  supported: 3,
};

export function selectEvidence<T extends { claimKey: string; status: Doc<"opportunityEvidence">["status"]; checkedAt: number; _id: string }>(
  rows: T[],
  claimKey: string,
): T | undefined {
  return rows
    .filter((r) => r.claimKey === claimKey)
    .sort(
      (a, b) =>
        EVIDENCE_STATUS_PRECEDENCE[a.status] - EVIDENCE_STATUS_PRECEDENCE[b.status] ||
        b.checkedAt - a.checkedAt ||
        a._id.localeCompare(b._id),
    )[0];
}

type RawFact = string | number | boolean | undefined;

function normalizeFact(rawFact: Exclude<RawFact, undefined>): string {
  return String(rawFact);
}

export function evaluateCriterion(
  criterion: { operator: string; expectedValues: string[] },
  rawFact: RawFact,
  evidence: EvidenceLike,
): CriterionResult {
  if (
    evidence === undefined ||
    evidence.status === "unsupported" ||
    evidence.status === "pending-review"
  ) {
    return "needs-evidence";
  }
  if (evidence.status === "contradicted") return "ambiguous";
  if (rawFact === undefined) return "unknown";
  const fact = normalizeFact(rawFact);
  let match: boolean;
  if (criterion.operator === "equals") {
    match = fact === criterion.expectedValues[0];
  } else if (criterion.operator === "one-of") {
    match = criterion.expectedValues.includes(fact);
  } else if (criterion.operator === "at-least" || criterion.operator === "at-most") {
    const bound = Number(criterion.expectedValues[0]);
    const numeric = Number(rawFact);
    if (!Number.isFinite(bound) || !Number.isFinite(numeric)) {
      throw new Error(`Operator "${criterion.operator}" needs numeric facts and bounds`);
    }
    match = criterion.operator === "at-least" ? numeric >= bound : numeric <= bound;
  } else {
    match =
      (typeof rawFact === "string" && rawFact.length > 0) ||
      (typeof rawFact === "number" && Number.isFinite(rawFact)) ||
      typeof rawFact === "boolean";
  }
  return match ? "met" : "unmet";
}

// ---------------------------------------------------------------------------
// Controlled eligibility hierarchy (issue #32).
//
// Source clauses classify into controlled criterion families; clause roles
// (mandatory / preferred / alternative / exception / informational) stay
// distinct through evaluation. Exact matching and normalization happen in
// code — evaluators never fall back to keyword parsing. Families without a
// mapped profile fact evaluate to "unknown" so they route to human review
// instead of being guessed.

export const CRITERION_FAMILIES = [
  "registration",
  "geography",
  "age",
  "ownership",
  "business-age",
  "revenue",
  "workforce",
  "sector",
  "documents",
  "prior-participation",
  "use-of-funds",
  "other",
] as const;

export type CriterionFamily = (typeof CRITERION_FAMILIES)[number];

export const CLAUSE_ROLES = [
  "mandatory",
  "preferred",
  "alternative",
  "exception",
  "informational",
  "unclear",
] as const;

export type ClauseRole = (typeof CLAUSE_ROLES)[number];

const FAMILY_PROFILE_FIELD: Record<CriterionFamily, Doc<"readinessCriteria">["profileField"] | null> = {
  registration: "cac",
  geography: "state",
  age: "age",
  ownership: "womenLed",
  "business-age": null,
  revenue: null,
  workforce: "staffSize",
  sector: "sector",
  documents: null,
  "prior-participation": null,
  "use-of-funds": null,
  other: null,
};

export function inferFamilyFromField(
  field: Doc<"readinessCriteria">["profileField"],
): CriterionFamily {
  const hit = (Object.entries(FAMILY_PROFILE_FIELD) as [CriterionFamily, string | null][]).find(
    ([, mapped]) => mapped === field,
  );
  return hit ? hit[0] : "other";
}

export function roleFromHardness(hardness: Doc<"readinessCriteria">["hardness"]): ClauseRole {
  return hardness === "hard" ? "mandatory" : "preferred";
}

export type CriterionShape = {
  criterionKey: string;
  operator: string;
  expectedValues: string[];
  role?: string;
  alternativeGroup?: string;
  exceptionTo?: string;
  family?: string;
};

/** Deterministic shape validation: unsupported shapes are rejected loudly. */
export function validateCriterionShape(criterion: CriterionShape): string[] {
  const errors: string[] = [];
  const operators = ["equals", "one-of", "present", "at-least", "at-most"];
  if (!operators.includes(criterion.operator)) {
    errors.push(`unsupported operator "${criterion.operator}"`);
  }
  if (
    (criterion.operator === "equals" || criterion.operator === "one-of") &&
    criterion.expectedValues.length === 0
  ) {
    errors.push(`operator "${criterion.operator}" requires non-empty expectedValues`);
  }
  if (criterion.operator === "at-least" || criterion.operator === "at-most") {
    const bound = Number(criterion.expectedValues[0]);
    if (criterion.expectedValues.length === 0 || !Number.isFinite(bound)) {
      errors.push(`operator "${criterion.operator}" requires a single numeric expectedValue`);
    }
  }
  if (criterion.family !== undefined && !(CRITERION_FAMILIES as readonly string[]).includes(criterion.family)) {
    errors.push(`unknown family "${criterion.family}"`);
  }
  if (criterion.role !== undefined && !(CLAUSE_ROLES as readonly string[]).includes(criterion.role)) {
    errors.push(`unknown role "${criterion.role}"`);
  }
  if (criterion.role === "alternative" && !criterion.alternativeGroup) {
    errors.push(`role "alternative" requires alternativeGroup`);
  }
  if (criterion.role === "exception" && !criterion.exceptionTo) {
    errors.push(`role "exception" requires exceptionTo`);
  }
  return errors;
}

export type HierarchyCriterion = {
  criterionKey: string;
  label: string;
  requirement: string;
  hardness: Doc<"readinessCriteria">["hardness"];
  profileField: Doc<"readinessCriteria">["profileField"];
  operator: string;
  expectedValues: string[];
  evidenceClaimKey: string;
  guidance?: string;
  family?: string;
  role?: string;
  alternativeGroup?: string;
  exceptionTo?: string;
};

export function resolveCriterionRole(criterion: {
  role?: string;
  hardness: Doc<"readinessCriteria">["hardness"];
}): ClauseRole {
  if (criterion.role && (CLAUSE_ROLES as readonly string[]).includes(criterion.role)) {
    return criterion.role as ClauseRole;
  }
  return roleFromHardness(criterion.hardness);
}

export function resolveCriterionFamily(criterion: {
  family?: string;
  profileField: Doc<"readinessCriteria">["profileField"];
}): CriterionFamily {
  if (criterion.family && (CRITERION_FAMILIES as readonly string[]).includes(criterion.family)) {
    return criterion.family as CriterionFamily;
  }
  return inferFamilyFromField(criterion.profileField);
}

/** Hierarchy-aware evaluation: shape-validated, family-mapped, no guessing. */
export function evaluateHierarchyCriterion(
  criterion: HierarchyCriterion,
  rawFact: RawFact,
  evidence: EvidenceLike,
): CriterionResult {
  const errors = validateCriterionShape({
    criterionKey: criterion.criterionKey,
    operator: criterion.operator,
    expectedValues: criterion.expectedValues,
    role: criterion.role,
    alternativeGroup: criterion.alternativeGroup,
    exceptionTo: criterion.exceptionTo,
    family: criterion.family,
  });
  if (errors.length > 0) {
    throw new Error(`Unsupported criterion shape (${criterion.criterionKey}): ${errors.join("; ")}`);
  }
  const family = resolveCriterionFamily(criterion);
  const role = resolveCriterionRole(criterion);
  if (role === "informational") return "met";
  if (FAMILY_PROFILE_FIELD[family] === null && family !== "other") {
    // No mapped profile fact: route to human review instead of guessing.
    return "unknown";
  }
  return evaluateCriterion(criterion, rawFact, evidence);
}

export type RoleAwareAssessment = {
  key: string;
  role: ClauseRole;
  hardness: Doc<"readinessCriteria">["hardness"];
  result: CriterionResult;
  alternativeGroup?: string;
  exceptionTo?: string;
};

function groupResult(results: CriterionResult[]): CriterionResult {
  if (results.includes("met")) return "met";
  if (results.includes("ambiguous")) return "ambiguous";
  if (results.includes("needs-evidence")) return "needs-evidence";
  if (results.includes("unknown")) return "unknown";
  return "unmet";
}

function roleHardness(role: ClauseRole, hardness: Doc<"readinessCriteria">["hardness"]): Doc<"readinessCriteria">["hardness"] {
  if (role === "mandatory" || role === "unclear") return "hard";
  return hardness;
}

/** Compose an overall verdict honoring alternatives, exceptions, and
 *  informational clauses. Throws on dangling references and degenerate
 *  groups so bad curation fails loudly instead of silently passing. */
export function composeReadinessWithRoles(assessments: RoleAwareAssessment[]): ReadinessOverall {
  const keys = new Set(assessments.map((a) => a.key));
  for (const a of assessments) {
    if (a.role === "exception" && (!a.exceptionTo || !keys.has(a.exceptionTo))) {
      throw new Error(`Exception criterion "${a.key}" has a dangling exceptionTo`);
    }
  }
  const groups = new Map<string, RoleAwareAssessment[]>();
  for (const a of assessments) {
    if (a.role !== "alternative") continue;
    const bucket = groups.get(a.alternativeGroup ?? "") ?? [];
    bucket.push(a);
    groups.set(a.alternativeGroup ?? "", bucket);
  }
  for (const [group, members] of groups) {
    if (members.length < 2) {
      throw new Error(`Alternative group "${group}" needs at least two members`);
    }
  }
  const waived = new Set<string>();
  for (const a of assessments) {
    if (a.role === "exception" && a.result === "met" && a.exceptionTo) waived.add(a.exceptionTo);
  }
  const effective: { criterion: { hardness: Doc<"readinessCriteria">["hardness"] }; result: CriterionResult }[] = [];
  const groupedKeys = new Set([...groups.values()].flat().map((a) => a.key));
  for (const a of assessments) {
    if (a.role === "informational" || a.role === "exception" || groupedKeys.has(a.key)) continue;
    effective.push({
      criterion: { hardness: roleHardness(a.role, a.hardness) },
      result: waived.has(a.key) ? "met" : a.result,
    });
  }
  for (const members of groups.values()) {
    effective.push({
      criterion: {
        hardness: members.some((m) => roleHardness(m.role, m.hardness) === "hard") ? "hard" : "remediable",
      },
      result: groupResult(members.map((m) => (waived.has(m.key) ? "met" : m.result))),
    });
  }
  return composeReadiness(effective);
}

export type ClauseJudgment = { choice: string; confidence: number };

export type ClauseJudge = (
  questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>,
  state: Record<string, unknown>,
) => Promise<Record<string, ClauseJudgment | undefined>>;

export type ClauseClassification = { family: CriterionFamily; role: ClauseRole };

export function clauseClassificationQuestions(prefix: string): Record<
  string,
  { type: "choice"; instructions: string; criteria: Record<string, string> }
> {
  return {
    [`${prefix}:family`]: {
      type: "choice" as const,
      instructions:
        "Which controlled family does the eligibility clause in `clause` belong to? Choose other when none fits.",
      criteria: Object.fromEntries([...CRITERION_FAMILIES.map((f) => [f, `The clause is about ${f}.`])]),
    },
    [`${prefix}:role`]: {
      type: "choice" as const,
      instructions:
        "What role does the eligibility clause in `clause` play? Mandatory blocks, preferred helps, alternative offers another way, exception waives a rule, informational only informs. Choose unclear when it cannot be resolved.",
      criteria: {
        mandatory: "The clause states a requirement that blocks eligibility.",
        preferred: "The clause states a preference that helps but does not block.",
        alternative: "The clause offers another acceptable way to qualify.",
        exception: "The clause waives a requirement for some applicants.",
        informational: "The clause only informs and affects nothing.",
        unclear: "The role cannot be resolved from the wording.",
      },
    },
  };
}

/** Parse one prefix of a batched classification answer set. */
export function parseClauseClassification(
  answers: Record<string, ClauseJudgment | undefined>,
  prefix: string,
): ClauseClassification {
  return {
    family: pickClassification(answers, `${prefix}:family`, CRITERION_FAMILIES, "other") as CriterionFamily,
    role: pickClassification(answers, `${prefix}:role`, CLAUSE_ROLES, "unclear") as ClauseRole,
  };
}

function pickClassification(
  answers: Record<string, ClauseJudgment | undefined>,
  key: string,
  allowed: readonly string[],
  fallback: CriterionFamily | ClauseRole,
): CriterionFamily | ClauseRole {
  const answer = answers[key];
  if (!answer || !allowed.includes(answer.choice) || answer.confidence < 0.5) return fallback;
  return answer.choice as CriterionFamily | ClauseRole;
}

/** Classify a source clause into the controlled hierarchy. Without a judge
 *  the outcome is explicitly other/unclear — never a keyword guess. */
export async function classifySourceClause(
  clause: string,
  judge?: ClauseJudge,
): Promise<ClauseClassification> {
  if (!judge) return { family: "other", role: "unclear" };
  const answers = await judge(clauseClassificationQuestions("clause"), { clause });
  return parseClauseClassification(answers, "clause");
}

export function composeReadiness(
  assessments: ReadonlyArray<{
    criterion: { hardness: Doc<"readinessCriteria">["hardness"] };
    result: CriterionResult;
  }>,
): ReadinessOverall {
  if (assessments.length === 0) return "needs-information";
  if (assessments.some((a) => a.criterion.hardness === "hard" && a.result === "unmet")) {
    return "not-currently-eligible";
  }
  if (
    assessments.some(
      (a) => a.result === "ambiguous" || a.result === "unknown" || a.result === "needs-evidence",
    )
  ) {
    return "needs-information";
  }
  if (assessments.some((a) => a.criterion.hardness === "remediable" && a.result === "unmet")) {
    return "can-become-ready";
  }
  return "ready";
}
