/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Id } from "./_generated/dataModel";
import {
  classifySourceClause,
  composeReadinessWithRoles,
  evaluateHierarchyCriterion,
  validateCriterionShape,
  type HierarchyCriterion,
} from "./readinessPolicy";
import { coveredGapKeys } from "./readinessPlanPolicy";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const SOURCE = "https://iprogrammes.boi.ng/";

function criterion(overrides: Partial<HierarchyCriterion>): HierarchyCriterion {
  return {
    _id: "x" as unknown as Id<"readinessCriteria">,
    _creationTime: 0,
    opportunityId: "x" as unknown as Id<"opportunities">,
    criterionKey: "k",
    label: "K",
    profileField: "cac",
    operator: "equals",
    expectedValues: ["Registered"],
    requirement: "Requirement.",
    hardness: "hard",
    evidenceClaimKey: "k",
    ...overrides,
  } as HierarchyCriterion;
}

const supported = { status: "supported" as const };

test("clauses classify through the judge, with an explicit fallback", async () => {
  const judged = await classifySourceClause("Must be CAC registered.", async () => ({
    "clause:family": { choice: "registration", confidence: 0.9 },
    "clause:role": { choice: "mandatory", confidence: 0.85 },
  }));
  expect(judged).toEqual({ family: "registration", role: "mandatory" });
  // No judge: explicitly other/unclear, never a keyword guess.
  expect(await classifySourceClause("Must be CAC registered.")).toEqual({
    family: "other",
    role: "unclear",
  });
  // Low-confidence or unknown answers fall back per dimension.
  const weak = await classifySourceClause("Something.", async () => ({
    "clause:family": { choice: "mystery", confidence: 0.99 },
    "clause:role": { choice: "mandatory", confidence: 0.2 },
  }));
  expect(weak).toEqual({ family: "other", role: "unclear" });
});

test("shape validation rejects unsupported criterion shapes", () => {
  expect(validateCriterionShape({ criterionKey: "a", operator: "equals", expectedValues: [] })).toEqual([
    'operator "equals" requires non-empty expectedValues',
  ]);
  expect(validateCriterionShape({ criterionKey: "b", operator: "at-least", expectedValues: ["many"] })).toEqual([
    'operator "at-least" requires a single numeric expectedValue',
  ]);
  expect(
    validateCriterionShape({ criterionKey: "c", operator: "equals", expectedValues: ["x"], role: "alternative" }),
  ).toEqual(['role "alternative" requires alternativeGroup']);
  expect(
    validateCriterionShape({ criterionKey: "d", operator: "equals", expectedValues: ["x"], role: "exception" }),
  ).toEqual(['role "exception" requires exceptionTo']);
  expect(
    validateCriterionShape({ criterionKey: "e", operator: "vibes", expectedValues: ["x"] }),
  ).toEqual(['unsupported operator "vibes"']);
  expect(
    validateCriterionShape({ criterionKey: "f", operator: "equals", expectedValues: ["x"], family: "finances" }),
  ).toEqual(['unknown family "finances"']);
  expect(
    validateCriterionShape({
      criterionKey: "g",
      operator: "at-least",
      expectedValues: ["3"],
      role: "preferred",
      family: "workforce",
    }),
  ).toEqual([]);
});

test("numeric operators compare by code", () => {
  const atLeast = criterion({ profileField: "staffSize", operator: "at-least", expectedValues: ["2"] });
  expect(evaluateHierarchyCriterion(atLeast, 3, supported)).toBe("met");
  expect(evaluateHierarchyCriterion(atLeast, 1, supported)).toBe("unmet");
  const atMost = criterion({ operator: "at-most", expectedValues: ["10"] });
  expect(evaluateHierarchyCriterion(atMost, 10, supported)).toBe("met");
  expect(evaluateHierarchyCriterion(atMost, 11, supported)).toBe("unmet");
});

test("families without a mapped fact stay unknown instead of guessed", () => {
  const revenue = criterion({ family: "revenue", role: "mandatory", profileField: "cac" });
  expect(evaluateHierarchyCriterion(revenue, "Registered", supported)).toBe("unknown");
  const info = criterion({ family: "use-of-funds", role: "informational", profileField: "cac" });
  expect(evaluateHierarchyCriterion(info, undefined, undefined)).toBe("met");
});

test("alternative groups resolve as one-of, and degenerate shapes throw", () => {
  const members = (results: ("met" | "unmet" | "unknown")[]) =>
    results.map((result, i) => ({
      key: `m${i}`,
      role: "alternative" as const,
      hardness: "remediable" as const,
      result,
      alternativeGroup: "g",
    }));
  expect(composeReadinessWithRoles(members(["unmet", "met"]))).toBe("ready");
  expect(composeReadinessWithRoles(members(["unmet", "unmet"]))).toBe("can-become-ready");
  expect(composeReadinessWithRoles(members(["unmet", "unknown"]))).toBe("needs-information");
  expect(() =>
    composeReadinessWithRoles([
      { key: "solo", role: "alternative", hardness: "remediable", result: "met", alternativeGroup: "g" },
    ]),
  ).toThrow(/at least two members/);
  expect(() =>
    composeReadinessWithRoles([
      { key: "e", role: "exception", hardness: "hard", result: "met", exceptionTo: "ghost" },
    ]),
  ).toThrow(/dangling exceptionTo/);
});

test("a met exception waives its hard target, informational stays out", () => {
  const base = [
    { key: "cac", role: "mandatory" as const, hardness: "hard" as const, result: "unmet" as const },
    { key: "cac-exempt", role: "exception" as const, hardness: "hard" as const, result: "met" as const, exceptionTo: "cac" },
    { key: "fund-use", role: "informational" as const, hardness: "remediable" as const, result: "met" as const },
  ];
  expect(composeReadinessWithRoles(base)).toBe("ready");
  expect(
    composeReadinessWithRoles(base.map((a) => (a.key === "cac-exempt" ? { ...a, result: "unmet" as const } : a))),
  ).toBe("not-currently-eligible");
});

test("covered gaps never become the plan gap", () => {
  const covered = coveredGapKeys([
    { key: "info", role: "informational", result: "met" },
    { key: "exc", role: "exception", result: "met", exceptionTo: "hard-req" },
    { key: "hard-req", role: "mandatory", result: "unmet" },
    { key: "alt-a", role: "alternative", result: "unmet", alternativeGroup: "g" },
    { key: "alt-b", role: "alternative", result: "met", alternativeGroup: "g" },
    { key: "open-alt", role: "alternative", result: "unmet", alternativeGroup: "h" },
  ]);
  expect([...covered].sort()).toEqual(["alt-a", "alt-b", "exc", "hard-req", "info"]);
  expect(covered.has("open-alt")).toBe(false);
});

test("hierarchy ambiguity routes to review", () => {
  expect(
    composeReadinessWithRoles([
      { key: "a", role: "mandatory", hardness: "hard", result: "ambiguous" },
    ]),
  ).toBe("needs-information");
});

// --- End-to-end: a grant works through evidence, profile answers, verdict ---

async function insertEvidence(
  t: ReturnType<typeof convexTest>,
  opportunityId: Id<"opportunities">,
  claimKey: string,
  passage: string,
) {
  await t.run(async (ctx) =>
    ctx.db.insert("opportunityEvidence", {
      opportunityId,
      claimType: "eligibility",
      claimKey,
      displayValue: claimKey,
      status: "supported",
      sourceUrl: SOURCE,
      sourcePassage: passage,
      checkedAt: AS_OF,
    }),
  );
}

async function insertCriterion(
  t: ReturnType<typeof convexTest>,
  opportunityId: Id<"opportunities">,
  value: Record<string, unknown>,
) {
  await t.run(async (ctx) => ctx.db.insert("readinessCriteria", { opportunityId, ...value } as never));
}

async function grantFixture(t: ReturnType<typeof convexTest>) {
  const id = await insertOpportunity(t, {
    title: "Rural Enterprise Grant (fixture)",
    type: "grant",
    amountOrBenefit: "₦2M grant + advisory",
  });
  const claims: [string, string][] = [
    ["rural-business", "providing financial support and business advisory services to nano, micro and small-scale businesses in rural areas"],
    ["women-or-youth", "open to women-owned businesses and entrepreneurs aged 18–35"],
    ["cac-or-history", "applicants must be CAC registered, or show two years of trading history"],
    ["cac-exempt", "established businesses operating at scale are exempt from the CAC requirement"],
    ["workforce", "businesses must employ at least one person full-time"],
    ["priority-sector", "priority is given to agro-processing and food businesses"],
    ["fund-use", "grant funds must be used for business purposes only"],
  ];
  for (const [claimKey, passage] of claims) await insertEvidence(t, id, claimKey, passage);
  const criteria: Record<string, unknown>[] = [
    {
      criterionKey: "rural-business",
      label: "Rural business",
      profileField: "state",
      operator: "one-of",
      expectedValues: ["Kano", "Kaduna", "Oyo", "Other"],
      requirement: "Operate outside the major commercial hubs.",
      hardness: "hard",
      family: "geography",
      role: "mandatory",
      evidenceClaimKey: "rural-business",
    },
    {
      criterionKey: "women-led",
      label: "Women-led",
      profileField: "womenLed",
      operator: "equals",
      expectedValues: ["true"],
      requirement: "Women own or lead the business.",
      hardness: "remediable",
      family: "ownership",
      role: "alternative",
      alternativeGroup: "founder-profile",
      evidenceClaimKey: "women-or-youth",
    },
    {
      criterionKey: "youth-founder",
      label: "Youth founder",
      profileField: "age",
      operator: "one-of",
      expectedValues: ["18–24", "25–35"],
      requirement: "Founder is aged 18–35.",
      hardness: "remediable",
      family: "age",
      role: "alternative",
      alternativeGroup: "founder-profile",
      evidenceClaimKey: "women-or-youth",
    },
    {
      criterionKey: "cac-registered",
      label: "CAC registered",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "CAC registered, unless exempt.",
      hardness: "hard",
      family: "registration",
      role: "mandatory",
      evidenceClaimKey: "cac-or-history",
    },
    {
      criterionKey: "scale-exempt",
      label: "Scale exemption",
      profileField: "businessStage",
      operator: "equals",
      expectedValues: ["Scaling"],
      requirement: "Businesses operating at scale are exempt from CAC registration.",
      hardness: "hard",
      family: "registration",
      role: "exception",
      exceptionTo: "cac-registered",
      evidenceClaimKey: "cac-exempt",
    },
    {
      criterionKey: "workforce",
      label: "Employs staff",
      profileField: "staffSize",
      operator: "at-least",
      expectedValues: ["1"],
      requirement: "At least one full-time employee.",
      hardness: "remediable",
      family: "workforce",
      role: "preferred",
      evidenceClaimKey: "workforce",
    },
    {
      criterionKey: "priority-sector",
      label: "Priority sector",
      profileField: "sector",
      operator: "one-of",
      expectedValues: ["Agro", "Food"],
      requirement: "Priority to agro-processing and food.",
      hardness: "remediable",
      family: "sector",
      role: "preferred",
      evidenceClaimKey: "priority-sector",
    },
    {
      criterionKey: "fund-use",
      label: "Fund use",
      profileField: "sector",
      operator: "present",
      expectedValues: [],
      requirement: "Funds must be used for business purposes only.",
      hardness: "remediable",
      family: "use-of-funds",
      role: "informational",
      evidenceClaimKey: "fund-use",
    },
  ];
  for (const c of criteria) await insertCriterion(t, id, c);
  return id;
}

test("grant journey: alternative met and exception waived means ready", async () => {
  const t = convexTest(schema, modules);
  const id = await grantFixture(t);
  const res = await t.query(api.opportunities.evaluateReadiness, {
    id,
    state: "Kano",
    womenLed: false,
    age: "25–35",
    cac: "Not yet",
    businessStage: "Scaling",
    staffSize: 3,
    sector: "Agro",
  });
  expect(res?.overall).toBe("ready");
  const plan = await t.query(api.opportunities.getReadinessPlan, {
    id,
    state: "Kano",
    womenLed: false,
    age: "25–35",
    cac: "Not yet",
    businessStage: "Scaling",
    staffSize: 3,
    sector: "Agro",
    asOf: AS_OF,
  });
  expect(plan?.planStatus).toBe("ready");
});

test("grant journey: hard blocker without waiver is not eligible", async () => {
  const t = convexTest(schema, modules);
  const id = await grantFixture(t);
  const res = await t.query(api.opportunities.evaluateReadiness, {
    id,
    state: "Kano",
    womenLed: false,
    age: "25–35",
    cac: "Not yet",
    businessStage: "Starting",
    staffSize: 3,
    sector: "Agro",
  });
  expect(res?.overall).toBe("not-currently-eligible");
});

test("grant journey: preferred miss only costs readiness, not eligibility", async () => {
  const t = convexTest(schema, modules);
  const id = await grantFixture(t);
  const res = await t.query(api.opportunities.evaluateReadiness, {
    id,
    state: "Kano",
    womenLed: true,
    cac: "Registered",
    businessStage: "Growing",
    staffSize: 0,
    sector: "Tech",
  });
  expect(res?.overall).toBe("can-become-ready");
});
