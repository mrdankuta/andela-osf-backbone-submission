/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import { explainPlanText } from "./assistant";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const DAY = 86400000;
const SOURCE = "https://www.boi.ng/source";

async function planFixture(t: ReturnType<typeof convexTest>, criteria: Record<string, unknown>[]) {
  const id = await insertOpportunity(t, {
    title: "Test grant",
    type: "grant",
    amountOrBenefit: "₦2M grant",
    deadline: AS_OF + 30 * DAY,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "geo",
      displayValue: "geo",
      status: "supported",
      sourceUrl: SOURCE,
      sourcePassage: "Open to businesses in Lagos.",
      checkedAt: AS_OF,
    });
    for (const c of criteria) {
      await ctx.db.insert("readinessCriteria", { opportunityId: id, ...c } as never);
    }
  });
  return id;
}

function geoCriterion() {
  return {
    criterionKey: "geo",
    label: "Operates in Lagos",
    profileField: "state",
    operator: "one-of",
    expectedValues: ["Lagos"],
    requirement: "Must operate in Lagos.",
    hardness: "hard",
    evidenceClaimKey: "geo",
  };
}

test("eligible plans preserve verdict and amount verbatim", async () => {
  const t = convexTest(schema, modules);
  const id = await planFixture(t, [geoCriterion()]);
  const plain = await t.query(api.assistant.explain, { id, mode: "plain", state: "Lagos", asOf: AS_OF });
  expect(plain?.text).toMatch(/ready for this opportunity/);
  expect(plain?.text).toContain("₦2M grant");
  const pidgin = await t.query(api.assistant.explain, { id, mode: "pidgin", state: "Lagos", asOf: AS_OF });
  expect(pidgin?.text).toMatch(/dey eligible/);
  expect(pidgin?.text).toContain("₦2M grant");
  expect(pidgin?.text).toMatch(/Na English be di original/);
});

test("ineligible plans keep the negation", async () => {
  const t = convexTest(schema, modules);
  const id = await planFixture(t, [geoCriterion()]);
  const plain = await t.query(api.assistant.explain, { id, mode: "plain", state: "Kano", asOf: AS_OF });
  expect(plain?.text).toMatch(/not currently eligible/);
  expect(plain?.text).toMatch(/Do not apply/);
  const pidgin = await t.query(api.assistant.explain, { id, mode: "pidgin", state: "Kano", asOf: AS_OF });
  expect(pidgin?.text).toMatch(/No apply/);
});

test("unknown verdicts stay unknown in both languages", async () => {
  const t = convexTest(schema, modules);
  const id = await planFixture(t, [geoCriterion()]);
  const plain = await t.query(api.assistant.explain, { id, mode: "plain", asOf: AS_OF });
  expect(plain?.text).toMatch(/do not know yet/);
  const pidgin = await t.query(api.assistant.explain, { id, mode: "pidgin", asOf: AS_OF });
  expect(pidgin?.text).toMatch(/no know yet/);
});

test("deadlines render verbatim with availability", async () => {
  const t = convexTest(schema, modules);
  const id = await planFixture(t, [geoCriterion()]);
  const date = new Date(AS_OF + 30 * DAY).toLocaleDateString();
  const plain = await t.query(api.assistant.explain, { id, mode: "plain", state: "Lagos", asOf: AS_OF });
  expect(plain?.text).toContain(date);
  expect(plain?.text).toContain("30 days available");
});

test("blocked plans name the alternative rule", async () => {
  const t = convexTest(schema, modules);
  const id = await planFixture(t, [geoCriterion()]);
  await t.run(async (ctx) =>
    ctx.db.insert("readinessGuides", {
      opportunityId: id,
      criterionKey: "geo",
      title: "Move to Lagos",
      detail: "Relocate the business.",
      sourceUrl: SOURCE,
      costEstimate: "Unknown.",
      dependencies: [],
      uncertainty: "Rules vary.",
      alternativeTitle: "Try Kano funds",
      alternativeDetail: "A Kano programme may fit.",
    }),
  );
  const plain = await t.query(api.assistant.explain, {
    id,
    mode: "plain",
    state: "Kano",
    asOf: AS_OF + 60 * DAY,
  });
  expect(plain?.text).toMatch(/Try Kano funds/);
});

test("unsupported languages fall back to grounded English", async () => {
  const t = convexTest(schema, modules);
  const id = await planFixture(t, [geoCriterion()]);
  const res = await t.query(api.assistant.explain, { id, mode: "en français, s'il vous plaît" });
  expect(res?.text).toMatch(/In plain words/);
  expect(res?.text).not.toMatch(/Na English be di original/);
});

test("explainPlanText keeps uncertainty and citations paths", () => {
  const text = explainPlanText(
    {
      overall: "can-become-ready",
      planStatus: "actionable",
      gap: {
        label: "CAC",
        result: "unmet",
        hardness: "remediable",
        requirement: "Must register.",
        guidance: "Visit CAC.",
      },
      action: {
        title: "Register",
        detail: "Go to CAC.",
        expectedDaysMin: 2,
        expectedDaysMax: null,
        costEstimate: "₦10,000",
        uncertainty: "Queues vary.",
      },
      deadline: { status: "unknown", daysAvailable: null },
      alternative: null,
    },
    { amountOrBenefit: "₦2M", deadline: undefined, contacts: { officialLink: "https://example.org/" } },
    "plain",
  );
  expect(text).toContain("₦10,000");
  expect(text).toContain("Queues vary.");
  expect(text).toContain("https://example.org/");
  expect(text).toMatch(/time not published/);
});
