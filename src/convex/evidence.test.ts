/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

async function glowId(t: ReturnType<typeof convexTest>): Promise<Id<"opportunities">> {
  const items = await t.query(api.opportunities.list, {});
  const glow = items.find((o) => o.title.includes("GLOW"));
  expect(glow).toBeDefined();
  return glow!._id;
}

test("seeded GLOW exposes seven claim-level evidence rows", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  const res = await t.query(api.opportunities.getEvidence, { id });
  expect(res).not.toBeNull();
  expect(res!.summary).toEqual({ status: "needs-review", supported: 4, total: 7 });
  expect(res!.claims).toHaveLength(7);

  const benefit = res!.claims.find((c) => c.claimType === "benefit");
  expect(benefit?.status).toBe("supported");
  expect(benefit?.displayValue).toBe("Affordable financing + mentorship + capacity building");
  expect(benefit?.sourcePassage).toBe(
    "A ₦10 billion fund empowering women-owned businesses with affordable financing, mentorship, and capacity-building programmes across all sectors in Nigeria.",
  );
  expect(benefit?.sourceUrl).toBe("https://iprogrammes.boi.ng/");

  const deadline = res!.claims.find((c) => c.claimType === "deadline");
  expect(deadline?.status).toBe("pending-review");
  expect(deadline?.displayValue).toBe("No application deadline published");
  expect(deadline?.note).toBeTruthy();

  const contact = res!.claims.find((c) => c.claimType === "contact");
  expect(contact?.status).toBe("unsupported");
  expect(contact?.sourcePassage).toBeUndefined();
  expect(contact?.note).toBeTruthy();

  const eligibility = res!.claims.filter((c) => c.claimType === "eligibility");
  expect(eligibility).toHaveLength(2);
  expect(eligibility.map((c) => c.claimKey).sort()).toEqual([
    "business-in-nigeria",
    "women-owned-business",
  ]);

  const order = res!.claims.map((c) => c.claimType);
  expect(order).toEqual([
    "benefit",
    "applicationStatus",
    "deadline",
    "eligibility",
    "eligibility",
    "contact",
    "officialDestination",
  ]);
  expect(res!.claims.every((c) => c.checkedAt > 0)).toBe(true);
});

test("public opportunity without evidence reports no-evidence", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  const res = await t.query(api.opportunities.getEvidence, { id });
  expect(res).not.toBeNull();
  expect(res!.summary).toEqual({ status: "no-evidence", supported: 0, total: 0 });
  expect(res!.claims).toEqual([]);
});

test("a contradicted claim flips the summary to contradicted", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  await t.run(async (ctx) =>
    ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "applicationStatus",
      claimKey: "application-status",
      displayValue: "Closed",
      status: "contradicted",
      sourceUrl: "https://iprogrammes.boi.ng/",
      sourcePassage: "Programme no longer listed among active interventions.",
      checkedAt: Date.now(),
    }),
  );
  const res = await t.query(api.opportunities.getEvidence, { id });
  expect(res!.summary.status).toBe("contradicted");
  expect(res!.summary.total).toBe(8);
  expect(res!.summary.supported).toBe(4);
});

test("getEvidence returns null for hidden and untrusted opportunities", async () => {
  const t = convexTest(schema, modules);
  const hiddenId = await insertOpportunity(t, { catalogVisibility: "hidden" });
  expect(await t.query(api.opportunities.getEvidence, { id: hiddenId })).toBeNull();
  const untrustedId = await insertOpportunity(t, {
    sourceUrl: "https://example.ng",
    contacts: { officialLink: "https://example.ng" },
  });
  expect(await t.query(api.opportunities.getEvidence, { id: untrustedId })).toBeNull();
});

test("evidence seeding is idempotent", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  const res = await t.query(api.opportunities.getEvidence, { id });
  expect(res!.claims).toHaveLength(7);
  expect(res!.summary).toEqual({ status: "needs-review", supported: 4, total: 7 });
});
