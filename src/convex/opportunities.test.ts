/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { seededGlow, seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("list returns the six seeded verified public records", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  expect(items.length).toBe(6);
  expect(items.every((o) => o.status === "verified")).toBe(true);
  expect(items.every((o) => o.catalogVisibility === "public")).toBe(true);
});

test("type filter and women-only filter narrow results", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const loans = await t.query(api.opportunities.list, { type: "loan" });
  expect(loans.length).toBe(3);
  const grants = await t.query(api.opportunities.list, { type: "grant" });
  expect(grants.length).toBe(1);
  const accelerators = await t.query(api.opportunities.list, { type: "accelerator" });
  expect(accelerators.length).toBe(1);
  const govPrograms = await t.query(api.opportunities.list, { type: "gov-program" });
  expect(govPrograms.length).toBe(1);
  const women = await t.query(api.opportunities.list, { womenOnly: true });
  expect(women.length).toBe(2);
  expect(women.every((o) => o.womenOnly)).toBe(true);
});

test("search matches title and provider name", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const byTitle = await t.query(api.opportunities.list, { search: "glow" });
  expect(byTitle.length).toBe(1);
  const byProvider = await t.query(api.opportunities.list, { search: "bank of industry" });
  expect(byProvider.length).toBe(3);
  const noMatch = await t.query(api.opportunities.list, { search: "nonexistent" });
  expect(noMatch.length).toBe(0);
});

test("match ranks eligible first with reasons", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const res = await t.query(api.opportunities.match, {
    state: "Lagos", sector: "fashion", cacStatus: "Registered", womenLed: true, needTypes: ["loan"],
  });
  const glow = res.find((o) => o.title.includes("GLOW"));
  expect(glow).toBeDefined();
  expect(glow!.matchTier).toBe("eligible");
  expect(glow!.matchReasons.length).toBeGreaterThan(0);
  expect(res[0]._id).toBe(glow!._id);
});

test("match never marks women-only records eligible when womenLed is not true", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const base = {
    state: "Lagos",
    sector: "fashion",
    cacStatus: "Registered",
    needTypes: ["loan"],
  };
  const findGlow = <T extends { title: string }>(rows: T[]) =>
    rows.find((o) => o.title.includes("GLOW"))!;
  const unknown = await t.query(api.opportunities.match, base);
  expect(findGlow(unknown).matchTier).toBe("check");
  expect(findGlow(unknown).matchReasons).toContain("Women-owned businesses only");
  const no = await t.query(api.opportunities.match, { ...base, womenLed: false });
  expect(findGlow(no).matchTier).toBe("check");
  expect(findGlow(no).matchReasons).toContain("Women-owned businesses only");
  const yes = await t.query(api.opportunities.match, { ...base, womenLed: true });
  expect(findGlow(yes).matchTier).toBe("eligible");
});

test("getById returns full detail shape", async () => {
  const t = convexTest(schema, modules);
  const glow = await seededGlow(t);
  const full = await t.query(api.opportunities.getById, { id: glow._id });
  expect(full?.steps.length).toBeGreaterThan(0);
  expect(full?.contacts.officialLink).toMatch(/^https:/);
});

test("evaluateReadiness returns assessments for the seeded GLOW criteria", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  const res = await t.query(api.opportunities.evaluateReadiness, {
    id,
    womenLed: true,
    state: "Lagos",
  });
  expect(res).not.toBeNull();
  expect(res!.assessments.length).toBe(2);
  expect(res!.overall).toBe("needs-information");
});
