/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const SOURCE = "https://www.boi.ng/source";

async function intakeFixture(t: ReturnType<typeof convexTest>) {
  const id = await insertOpportunity(t, {});
  await t.run(async (ctx) => {
    for (const claimKey of ["cac", "geo", "youth", "waiver", "info"]) {
      await ctx.db.insert("opportunityEvidence", {
        opportunityId: id,
        claimType: "eligibility",
        claimKey,
        displayValue: claimKey,
        status: "supported",
        sourceUrl: SOURCE,
        checkedAt: AS_OF,
      });
    }
    const criteria: Record<string, unknown>[] = [
      {
        criterionKey: "cac-registered",
        label: "CAC registered",
        profileField: "cac",
        operator: "equals",
        expectedValues: ["Registered"],
        requirement: "Must be CAC registered.",
        hardness: "hard",
        family: "registration",
        role: "mandatory",
        evidenceClaimKey: "cac",
      },
      {
        criterionKey: "lives-here",
        label: "Operates here",
        profileField: "state",
        operator: "one-of",
        expectedValues: ["Lagos", "Kano"],
        requirement: "Must operate in Lagos or Kano.",
        hardness: "hard",
        family: "geography",
        role: "mandatory",
        evidenceClaimKey: "geo",
      },
      {
        criterionKey: "youth",
        label: "Youth founder",
        profileField: "age",
        operator: "one-of",
        expectedValues: ["18–24"],
        requirement: "Founder is under 25.",
        hardness: "remediable",
        family: "age",
        role: "alternative",
        alternativeGroup: "who",
        evidenceClaimKey: "youth",
      },
      {
        criterionKey: "women",
        label: "Women-led",
        profileField: "womenLed",
        operator: "equals",
        expectedValues: ["true"],
        requirement: "Women lead the business.",
        hardness: "remediable",
        family: "ownership",
        role: "alternative",
        alternativeGroup: "who",
        evidenceClaimKey: "youth",
      },
      {
        criterionKey: "veteran-waiver",
        label: "Veteran waiver",
        profileField: "businessStage",
        operator: "equals",
        expectedValues: ["Scaling"],
        requirement: "Scaling businesses skip CAC.",
        hardness: "hard",
        family: "registration",
        role: "exception",
        exceptionTo: "cac-registered",
        evidenceClaimKey: "waiver",
      },
      {
        criterionKey: "fund-note",
        label: "Fund note",
        profileField: "sector",
        operator: "present",
        expectedValues: [],
        requirement: "Funds for business use.",
        hardness: "remediable",
        family: "use-of-funds",
        role: "informational",
        evidenceClaimKey: "info",
      },
    ];
    for (const c of criteria) {
      await ctx.db.insert("readinessCriteria", { opportunityId: id, ...c } as never);
    }
  });
  return id;
}

test("answered facts are reused, only unknowns are asked", async () => {
  const t = convexTest(schema, modules);
  const id = await intakeFixture(t);
  const fresh = await t.query(api.opportunities.intakeQuestions, { id });
  const fields = fresh?.questions.map((q) => q.profileField).sort();
  // cac, state unknown; age/womenLed unknown (group open); businessStage unknown
  // (target unmet? no — cac unknown, so no waiver question); sector informational.
  expect(fields).toEqual(["age", "cac", "state", "womenLed"]);
  const answered = await t.query(api.opportunities.intakeQuestions, {
    id,
    cac: "Registered",
    state: "Lagos",
    age: "18–24",
    womenLed: true,
    businessStage: "Growing",
    sector: "Tech",
  });
  expect(answered?.questions).toEqual([]);
});

test("a met alternative silences its group", async () => {
  const t = convexTest(schema, modules);
  const id = await intakeFixture(t);
  const res = await t.query(api.opportunities.intakeQuestions, { id, womenLed: true });
  const fields = res?.questions.map((q) => q.profileField) ?? [];
  expect(fields).not.toContain("womenLed");
  expect(fields).not.toContain("age");
});

test("a blocking target triggers its waiver question", async () => {
  const t = convexTest(schema, modules);
  const id = await intakeFixture(t);
  const res = await t.query(api.opportunities.intakeQuestions, {
    id,
    cac: "Not yet",
    state: "Lagos",
    womenLed: true,
  });
  const waiver = res?.questions.find((q) => q.profileField === "businessStage");
  expect(waiver).toBeDefined();
  expect(waiver?.affects[0].why).toMatch(/waive cac-registered/);
});

test("every question names its criterion and why it matters", async () => {
  const t = convexTest(schema, modules);
  const id = await intakeFixture(t);
  const res = await t.query(api.opportunities.intakeQuestions, { id });
  const cac = res?.questions.find((q) => q.profileField === "cac");
  expect(cac?.label).toBe("CAC registration status");
  expect(cac?.kind).toBe("select");
  expect(cac?.options).toContain("Registered");
  expect(cac?.affects[0].criterionKey).toBe("cac-registered");
  expect(cac?.affects[0].why).toMatch(/blocks eligibility/);
  const state = res?.questions.find((q) => q.profileField === "state");
  expect(state?.affects[0].why).toMatch(/Must operate in Lagos or Kano/);
});

test("answers move the verdict with no favorable defaults", async () => {
  const t = convexTest(schema, modules);
  const id = await intakeFixture(t);
  const before = await t.query(api.opportunities.evaluateReadiness, { id });
  expect(before?.overall).toBe("needs-information");
  const answered = await t.query(api.opportunities.evaluateReadiness, {
    id,
    cac: "Registered",
    state: "Lagos",
    womenLed: true,
    businessStage: "Growing",
    sector: "Tech",
  });
  // youth unknown but group met via womenLed; waiver unmet (Growing≠Scaling) so
  // target cac is met anyway; informational met. Verdict: ready.
  expect(answered?.overall).toBe("ready");
  // Skipped answers stay unknown: omitting cac keeps needs-information.
  const skipped = await t.query(api.opportunities.evaluateReadiness, {
    id,
    state: "Lagos",
    womenLed: true,
  });
  expect(skipped?.overall).toBe("needs-information");
  expect(
    skipped?.assessments.find((a) => a.criterionKey === "cac-registered")?.result,
  ).toBe("unknown");
});

test("intake is opportunity-specific and unauthorized stays null", async () => {
  const t = convexTest(schema, modules);
  const id = await intakeFixture(t);
  const other = await insertOpportunity(t, { title: "Other" });
  const res = await t.query(api.opportunities.intakeQuestions, { id: other });
  expect(res?.questions).toEqual([]);
  await t.run(async (ctx) => ctx.db.delete(id));
  expect(await t.query(api.opportunities.intakeQuestions, { id })).toBeNull();
});
