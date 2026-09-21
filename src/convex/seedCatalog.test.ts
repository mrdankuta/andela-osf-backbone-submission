/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { TestConvex } from "convex-test";

const modules = import.meta.glob("./**/*.ts");

const MTN_DEADLINE = Date.parse("2026-10-11T23:59:59+01:00");

const EXPECTED_TITLES = [
  "GLOW — Guaranteed Loans for Women",
  "MTN ICT and Business Skills Training — Phase 8",
  "NiYA Startup 2.0",
  "Student Venture Capital Grant (S-VCG)",
  "BOI–iDICE Debt Fund",
  "RAPID — Rural Area Programme on Investment for Development",
];

const NEW_TITLES = EXPECTED_TITLES.slice(1);

async function childCounts(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => ({
    evidence: (await ctx.db.query("opportunityEvidence").collect()).length,
    criteria: (await ctx.db.query("readinessCriteria").collect()).length,
    guides: (await ctx.db.query("readinessGuides").collect()).length,
  }));
}

test("seed reports six records and lists the six exact titles", async () => {
  const t = convexTest(schema, modules);
  const res = await t.mutation(internal.seed.seed, {});
  expect(res).toEqual({ seeded: true, count: 6 });
  const items = await t.query(api.opportunities.list, {});
  expect(items.map((o) => o.title).sort()).toEqual([...EXPECTED_TITLES].sort());
});

test("every record is verified, public, https-linked, and evidenced", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  expect(items.length).toBe(6);
  for (const o of items) {
    expect(o.status).toBe("verified");
    expect(o.catalogVisibility).toBe("public");
    expect(o.sourceUrl).toMatch(/^https:\/\//);
    expect(o.contacts.officialLink).toMatch(/^https:\/\//);
    const evidence = await t.query(api.opportunities.getEvidence, { id: o._id });
    expect(evidence?.claims.length).toBeGreaterThan(0);
  }
});

test("only MTN carries a deadline; the other five carry a note", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const mtn = items.find((o) => o.title.includes("MTN"))!;
  expect(mtn.deadline).toBe(MTN_DEADLINE);
  for (const o of items.filter((i) => i._id !== mtn._id)) {
    expect(o.deadline).toBeUndefined();
    expect(o.deadlineNote).toBeTruthy();
  }
});

test("seeding twice is idempotent for rows and children", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const first = await childCounts(t);
  const res = await t.mutation(internal.seed.seed, {});
  expect(res.count).toBe(6);
  expect(res.seeded).toBe(false);
  const items = await t.query(api.opportunities.list, {});
  expect(items.length).toBe(6);
  expect(new Set(items.map((o) => o.sourceUrl)).size).toBe(6);
  const second = await childCounts(t);
  expect(second).toEqual(first);
});

test("catalog counts by type and audience flags", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const count = (pred: (o: (typeof items)[number]) => boolean) => items.filter(pred).length;
  expect(count((o) => o.type === "loan")).toBe(3);
  expect(count((o) => o.type === "accelerator")).toBe(1);
  expect(count((o) => o.type === "grant")).toBe(1);
  expect(count((o) => o.type === "gov-program")).toBe(1);
  expect(count((o) => o.womenOnly === true)).toBe(2);
  expect(count((o) => o.youthOnly === true)).toBe(3);
});

test("a complete profile can never reach ready on new records", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const facts = {
    state: "Kano",
    sector: "Tech",
    businessStage: "Growing",
    cac: "Registered",
    staffSize: 4,
    age: "25–35",
    womenLed: true,
  };
  for (const title of NEW_TITLES) {
    const opp = items.find((o) => o.title === title)!;
    const res = await t.query(api.opportunities.evaluateReadiness, { id: opp._id, ...facts });
    expect(res).not.toBeNull();
    const gate = res!.assessments.find((a) => a.criterionKey.startsWith("manual-review-"));
    expect(gate, `${title} must carry a manual-review gate`).toBeDefined();
    expect(gate!.result).toBe("needs-evidence");
    expect(res!.overall).not.toBe("ready");
  }
});

test("source-specific facts survive seeding", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const byTitle = (needle: string) => items.find((o) => o.title.includes(needle))!;
  const claims = async (needle: string) =>
    (await t.query(api.opportunities.getEvidence, { id: byTitle(needle)._id }))!.claims;
  const claim = async (needle: string, key: string) =>
    (await claims(needle)).find((c) => c.claimKey === key)!;

  const MTN_APPLY_URL = "https://mtnictandbusinessskills.mtn.ng/mtn-foundation";
  const mtnDeadline = await claim("MTN", "deadline");
  expect(mtnDeadline.displayValue).toBe("Applications close 11 October 2026");
  expect(mtnDeadline.status).toBe("supported");
  const mtnStates = await claim("MTN", "eligible-states");
  expect(mtnStates.sourcePassage).toContain("3,000");
  const mtnDest = await claim("MTN", "official-destination");
  expect(mtnDest.displayValue).toBe(MTN_APPLY_URL);
  expect(mtnDest.sourceUrl).toBe(MTN_APPLY_URL);
  expect(byTitle("MTN").contacts.officialLink).toBe(MTN_APPLY_URL);

  const niyaBenefit = await claim("NiYA", "benefit");
  expect(niyaBenefit.sourcePassage).toContain("₦100,000,000");
  const niyaDest = await claim("NiYA", "official-destination");
  expect(niyaDest.sourcePassage).toContain("Apply as a New Member");

  const svcgBenefit = await claim("S-VCG", "benefit");
  expect(svcgBenefit.sourcePassage).toContain("₦50M");
  const svcgCac = await claim("S-VCG", "cac");
  expect(svcgCac.sourcePassage).toContain("CAC-registered");
  const svcgStudent = await claim("S-VCG", "student");
  expect(svcgStudent.sourcePassage).toBe(
    "You must be a student currently enrolled in a Nigerian tertiary institution — that includes universities, polytechnics, and colleges of education.",
  );
  const svcgStemm = await claim("S-VCG", "stemm");
  expect(svcgStemm.sourcePassage).toBe(
    "We’re looking for ideas, solutions, projects, or businesses that fall under STEMMS — that’s Science, Technology, Engineering, Mathematics, and Medical Sciences.",
  );

  const idiceStatus = await claim("iDICE", "application-status");
  expect(idiceStatus.sourcePassage).toContain("signify your interest");
  const idiceViability = await claim("iDICE", "viability");
  expect(idiceViability.sourcePassage).toBe(
    "Demonstrate commercial viability and growth potential",
  );
  expect(byTitle("iDICE").sourceUrl).toContain("idice.boi.ng");

  const rapidBenefit = await claim("RAPID", "benefit");
  expect(rapidBenefit.sourceUrl).toBe("https://onlineportal.boi.ng/");
  expect(rapidBenefit.sourcePassage).toContain("₦10M");
  const rapidRural = await claim("RAPID", "rural-business");
  expect(rapidRural.sourcePassage).toBe(
    "The objective of the programme is to assist communities in rural and economically disadvantaged areas to tap into available resources for the development of enterprises that can provide employment, improve standard of living, contribute to national growth and tame insecurity arising from youth restiveness.",
  );
  const rapidDest = await claim("RAPID", "official-destination");
  expect(rapidDest.displayValue).toBe("https://rapid.boi.ng/register");
  expect(byTitle("RAPID").contacts.officialLink).toBe("https://rapid.boi.ng/register");
});
