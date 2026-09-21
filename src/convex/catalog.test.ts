/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, publicOpportunity } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("providers seeded and state amount filters work", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const provs = await t.query(api.providers.listProviders, {});
  expect(provs.length).toBeGreaterThan(0);
  expect(provs.some((p) => p.name === "Bank of Industry")).toBe(true);
  const lagos = await t.query(api.opportunities.list, { state: "Lagos" });
  expect(lagos.length).toBeGreaterThan(0);
  expect(lagos.every((o) => o.locationEligibility === "All Nigeria" || o.locationEligibility.toLowerCase().includes("lagos"))).toBe(true);
  await insertOpportunity(t, { title: "BOI Growth Loan", amountValue: 5000000 });
  const rich = await t.query(api.opportunities.list, { amountMin: 2000000, sort: "amount" });
  expect(rich.length).toBe(1);
  expect(rich[0].title).toBe("BOI Growth Loan");
  for (let i = 1; i < rich.length; i++) {
    expect((rich[i - 1].amountValue ?? 0) >= (rich[i].amountValue ?? 0)).toBe(true);
  }
});

test("expiry cron skips missing deadlines and expires past ones", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const first = await t.mutation(internal.crons.expirePastDeadlines, {});
  expect(first.expired).toBe(0);
  expect(await t.query(api.opportunities.getById, { id: items[0]._id })).not.toBeNull();
  await insertOpportunity(t, { title: "Past Deadline Fixture", deadline: Date.now() - 86400000 });
  const res = await t.mutation(internal.crons.expirePastDeadlines, {});
  expect(res.expired).toBe(1);
});

test("seed publishes exactly six verified public opportunities", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  expect(items.length).toBe(6);
  const glow = items.find((o) => o.title.includes("GLOW"));
  expect(glow).toBeDefined();
  expect(glow!.status).toBe("verified");
  expect(glow!.catalogVisibility).toBe("public");
  expect(glow!.sourceUrl).toMatch(/^https:\/\/.*boi\.ng/);
  expect(glow!.contacts.officialLink).toMatch(/^https:\/\/.*boi\.ng/);
  expect(glow!.deadline).toBeUndefined();
  expect(glow!.deadlineNote).toBeTruthy();
});

test("seed hides pre-existing catalog rows", async () => {
  const t = convexTest(schema, modules);
  const legacy = publicOpportunity({ title: "Legacy synthetic listing" });
  delete legacy.catalogVisibility;
  const legacyId = await t.run(async (ctx) => ctx.db.insert("opportunities", legacy));
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  expect(items.length).toBe(6);
  expect(items.some((o) => o.title.includes("GLOW"))).toBe(true);
  expect(await t.query(api.opportunities.getById, { id: legacyId })).toBeNull();
  const stored = await t.run(async (ctx) => ctx.db.get("opportunities", legacyId));
  expect(stored?.catalogVisibility).toBe("hidden");
});

test("seed replace clears stale fields on a pre-existing GLOW-source row", async () => {
  const t = convexTest(schema, modules);
  await insertOpportunity(t, {
    title: "GLOW — Guaranteed Loans for Women",
    sourceUrl: "https://iprogrammes.boi.ng/",
    deadline: Date.now() + 30 * 86400000,
    amountValue: 50000000,
    contacts: {
      officialLink: "https://example.ng",
      phone: "0800-FAKE",
      email: "fake@example.ng",
    },
    screenshots: ["stale.png"],
  });
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const glowRows = items.filter((o) => o.sourceUrl === "https://iprogrammes.boi.ng/");
  expect(glowRows.length).toBe(1);
  const glow = glowRows[0];
  expect(glow.title).toContain("GLOW");
  expect(glow.deadline).toBeUndefined();
  expect(glow.amountValue).toBeUndefined();
  expect(glow.contacts).toEqual({ officialLink: "https://glow.boi.ng/" });
});

test("placeholder marked public+verified cannot surface through public functions", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const placeholderId = await t.run(async (ctx) =>
    ctx.db.insert("opportunities", {
      title: "Placeholder Demo Grant",
      providerName: "Example Provider",
      providerType: "Gov",
      type: "grant",
      amountOrBenefit: "₦1M",
      deadline: Date.now() + 10 * 86400000,
      locationEligibility: "All Nigeria",
      sectorTags: ["all"],
      summaryPlain: "Synthetic placeholder listing.",
      eligibilityRules: ["Nigerian"],
      steps: [{ order: 1, title: "Apply", detail: "Submit.", link: "https://example.ng" }],
      documents: [],
      contacts: { officialLink: "https://example.ng" },
      sourceUrl: "https://example.ng",
      lastVerified: Date.now(),
      status: "verified",
      catalogVisibility: "public",
    }),
  );
  const items = await t.query(api.opportunities.list, {});
  expect(items.find((o) => o._id === placeholderId)).toBeUndefined();
  const matched = await t.query(api.opportunities.match, {});
  expect(matched.find((o) => o._id === placeholderId)).toBeUndefined();
  expect(await t.query(api.opportunities.getById, { id: placeholderId })).toBeNull();
  expect(await t.query(api.opportunities.evaluateReadiness, { id: placeholderId })).toBeNull();
  await expect(
    t.mutation(api.track.save, { opportunityId: placeholderId, deviceId: "dev-x" }),
  ).rejects.toThrow("Opportunity unavailable.");
});
