/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, seededGlowId } from "../test/convexFixtures";
import type { Id } from "./_generated/dataModel";
import { resolveProviderForEmail } from "./providers";

const modules = import.meta.glob("./**/*.ts");

async function asIdentity(
  t: ReturnType<typeof convexTest>,
  kind: "user" | "device" | undefined,
  id?: string,
  email?: string,
) {
  await t.mutation(
    internal.identity._setTestIdentity,
    kind && id ? { kind, id, email } : {},
  );
}

async function glowId(t: ReturnType<typeof convexTest>) {
  return seededGlowId(t);
}

async function providerAuth(t: ReturnType<typeof convexTest>, email: string) {
  const providers = await t.query(api.providers.listProviders, {});
  const boi = providers.find((p) => p.name === "Bank of Industry")!;
  await t.mutation(api.providers.setProviderAccess, { providerId: boi._id, emails: [email] });
}

test("provider resolution prefers allowlists, then domains", () => {
  const providers = [
    { _id: "a", name: "Bank of Industry", officialLink: "https://www.boi.ng", authorizedEmails: ["boss@boi.ng"] },
    { _id: "b", name: "Other MFB", officialLink: "https://app.othermfb.com" },
  ];
  expect(resolveProviderForEmail("boss@boi.ng", providers)?.name).toBe("Bank of Industry");
  expect(resolveProviderForEmail("staff@othermfb.com", providers)?.name).toBe("Other MFB");
  expect(resolveProviderForEmail("stranger@gmail.com", providers)).toBeNull();
  expect(resolveProviderForEmail("x@glow.boi.ng", providers)?.name).toBe("Bank of Industry");
});

async function sixUsers(t: ReturnType<typeof convexTest>, id: Id<"opportunities">) {
  for (let i = 0; i < 6; i++) {
    const dev = `cohort-${i}`;
    await t.mutation(api.profiles.save, {
      ownerKey: dev,
      state: "Lagos",
      womenLed: i < 2,
      email: `${dev}@example.org`,
    });
    await t.mutation(api.track.save, { opportunityId: id, deviceId: dev });
  }
}

test("small cohorts suppress entirely", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "solo-1" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "solo-2" });
  await providerAuth(t, "bank@boi.ng");
  await asIdentity(t, "user", "user:banker", "bank@boi.ng");
  const insights = await t.query(api.providerInsights.myProviderInsights, {});
  expect(insights.providerName).toBe("Bank of Industry");
  const glow = insights.opportunities.find((o) => o.opportunityId === id)!;
  expect(glow.suppressed).toBe(true);
  expect(glow.funnel).toEqual([]);
  await asIdentity(t, undefined);
});

test("unsuppressed cohorts show funnels, gaps, abandonment, and outcomes", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await sixUsers(t, id);
  // Two users abandon with reasons; one applies.
  for (const dev of ["cohort-0", "cohort-1"]) {
    await t.mutation(api.track.setPlanState, {
      opportunityId: id,
      deviceId: dev,
      state: "abandoned",
      abandonReason: "Deadline passed",
    });
  }
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: "cohort-2", state: "ready" });
  await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "cohort-2",
    opportunityId: id,
    outcome: "submitted",
  });
  await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "cohort-3",
    opportunityId: id,
    outcome: "rejected",
    reasonCode: "no-response",
  });
  await t.mutation(api.planOutcomes.confirmOutcome, {
    ownerKey: "cohort-3",
    opportunityId: id,
    outcome: "rejected",
  });
  await providerAuth(t, "bank@boi.ng");
  await asIdentity(t, "user", "user:banker", "bank@boi.ng");
  const insights = await t.query(api.providerInsights.myProviderInsights, {});
  const glow = insights.opportunities.find((o) => o.opportunityId === id)!;
  expect(glow.suppressed).toBe(false);
  const funnel = Object.fromEntries(glow.funnel.map((f) => [f.state, f.count]));
  expect(funnel.abandoned).toBe(2);
  expect(glow.topGaps.some((g) => g.label.includes("Women"))).toBe(true);
  expect(glow.abandonReasons).toEqual([{ reason: "Deadline passed", count: 2 }]);
  const submitted = glow.outcomes.find((o) => o.outcome === "submitted");
  expect(submitted?.reportedBy).toBe("user");
  const rejected = glow.outcomes.find((o) => o.outcome === "rejected");
  expect(rejected?.reportedBy).toBe("provider");
  await asIdentity(t, undefined);
});

test("consent withdrawal and deletion leave aggregates", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await sixUsers(t, id);
  await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "cohort-0",
    opportunityId: id,
    outcome: "rejected",
  });
  await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "cohort-1",
    opportunityId: id,
    outcome: "rejected",
  });
  await t.mutation(api.planOutcomes.setOutcomeSharing, {
    ownerKey: "cohort-0",
    opportunityId: id,
    includeInLearning: false,
  });
  await t.mutation(api.planOutcomes.deleteOutcome, { ownerKey: "cohort-1", opportunityId: id });
  await providerAuth(t, "bank@boi.ng");
  await asIdentity(t, "user", "user:banker", "bank@boi.ng");
  const insights = await t.query(api.providerInsights.myProviderInsights, {});
  expect(insights.opportunities.find((o) => o.opportunityId === id)!.outcomes).toEqual([]);
  await asIdentity(t, undefined);
});

test("wrong providers and anonymous callers see nothing", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await sixUsers(t, id);
  const other = await insertOpportunity(t, {
    title: "Other fund",
    providerName: "Other MFB",
    contacts: { officialLink: "https://app.othermfb.com/apply" },
    sourceUrl: "https://app.othermfb.com/fund",
  });
  await providerAuth(t, "bank@boi.ng");
  await asIdentity(t, "user", "user:banker", "bank@boi.ng");
  const insights = await t.query(api.providerInsights.myProviderInsights, {});
  expect(insights.opportunities.every((o) => o.opportunityId !== other)).toBe(true);
  expect(insights.opportunities.find((o) => o.opportunityId === id)).toBeTruthy();
  await asIdentity(t, "user", "user:stranger", "stranger@gmail.com");
  await expect(t.query(api.providerInsights.myProviderInsights, {})).rejects.toThrow(/No provider program/);
  await asIdentity(t, undefined);
  await expect(t.query(api.providerInsights.myProviderInsights, {})).rejects.toThrow(/Sign in/);
});
