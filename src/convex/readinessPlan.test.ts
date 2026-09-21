/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Doc, Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const DAY = 86400000;

async function glowId(t: ReturnType<typeof convexTest>): Promise<Id<"opportunities">> {
  const items = await t.query(api.opportunities.list, {});
  const glow = items.find((o) => o.title.includes("GLOW"));
  expect(glow).toBeDefined();
  return glow!._id;
}

async function insertEvidence(
  t: ReturnType<typeof convexTest>,
  opportunityId: Id<"opportunities">,
  overrides: Partial<Doc<"opportunityEvidence">> & {
    claimKey: string;
    status: Doc<"opportunityEvidence">["status"];
  },
) {
  const { claimKey, status, ...rest } = overrides;
  await t.run(async (ctx) =>
    ctx.db.insert("opportunityEvidence", {
      opportunityId,
      claimType: "eligibility",
      claimKey,
      displayValue: claimKey,
      status,
      sourceUrl: "https://www.boi.ng/source",
      checkedAt: AS_OF,
      ...rest,
    }),
  );
}

async function insertCriterion(
  t: ReturnType<typeof convexTest>,
  opportunityId: Id<"opportunities">,
  overrides: Partial<Doc<"readinessCriteria">> & { criterionKey: string },
) {
  const { criterionKey, ...rest } = overrides;
  await t.run(async (ctx) =>
    ctx.db.insert("readinessCriteria", {
      opportunityId,
      criterionKey,
      label: criterionKey,
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "Fixture requirement.",
      hardness: "hard",
      evidenceClaimKey: criterionKey,
      ...rest,
    }),
  );
}

async function insertGuide(
  t: ReturnType<typeof convexTest>,
  opportunityId: Id<"opportunities">,
  overrides: Partial<Doc<"readinessGuides">> & { criterionKey: string },
) {
  const { criterionKey, ...rest } = overrides;
  await t.run(async (ctx) =>
    ctx.db.insert("readinessGuides", {
      opportunityId,
      criterionKey,
      title: `Guide for ${criterionKey}`,
      detail: "Follow the official guidance.",
      sourceUrl: "https://www.boi.ng/guide",
      costEstimate: "Fixture cost estimate.",
      dependencies: ["Fixture dependency"],
      uncertainty: "Fixture uncertainty.",
      alternativeTitle: "Fixture alternative",
      alternativeDetail: "Review another opportunity.",
      ...rest,
    }),
  );
}

test("seeded GLOW needs-evidence gap produces an actionable plan with the curated guide", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    womenLed: true,
    state: "Lagos",
    asOf: AS_OF,
  });
  expect(res).not.toBeNull();
  expect(res!.planStatus).toBe("actionable");
  expect(res!.gap?.criterionKey).toBe("business-in-nigeria");
  expect(res!.gap?.result).toBe("needs-evidence");
  expect(res!.action?.title).toBe("Confirm GLOW's location requirement");
  expect(res!.action?.sourceUrl).toBe("https://glow.boi.ng/");
  expect(res!.action?.expectedDaysMin).toBeNull();
  expect(res!.action?.expectedDaysMax).toBeNull();
  expect(res!.action?.costEstimate).toBe("No application or verification cost is published.");
  expect(res!.action?.dependencies).toEqual([
    "Current GLOW programme terms",
    "Your confirmed operating state",
  ]);
  expect(res!.action?.uncertainty).toContain("does not publish a complete location eligibility rule");
  expect(res!.deadline).toEqual({ status: "unknown", daysAvailable: null });

  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-plan" });
  const tracked = await t.query(api.track.list, { deviceId: "dev-plan" });
  expect(tracked.some((r) => r.opportunityId === id)).toBe(true);
});

test("seeded GLOW women-led false blocks with a do-not-apply alternative", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    womenLed: false,
    state: "Lagos",
    asOf: AS_OF,
  });
  expect(res!.planStatus).toBe("blocked");
  expect(res!.gap?.criterionKey).toBe("women-owned-business");
  expect(res!.gap?.result).toBe("unmet");
  expect(res!.action).toBeNull();
  expect(res!.alternative?.title).toBe(
    "Review opportunities without a women-ownership requirement",
  );
  expect(res!.alternative?.detail).toContain("do not apply to GLOW");
  expect(res!.deadline).toEqual({ status: "unknown", daysAvailable: null });
});

test("remediable gap with guide estimates and a ten-day deadline is feasible and actionable", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: AS_OF + 10 * DAY });
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered", hardness: "remediable" });
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    expectedDaysMin: 2,
    expectedDaysMax: 5,
  });
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    cac: "Not yet",
    asOf: AS_OF,
  });
  expect(res!.planStatus).toBe("actionable");
  expect(res!.action?.expectedDaysMin).toBe(2);
  expect(res!.action?.expectedDaysMax).toBe(5);
  expect(res!.deadline).toEqual({ status: "feasible", daysAvailable: 10 });
});

test("a one-day deadline makes the plan infeasible and returns an alternative", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: AS_OF + 1 * DAY });
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered", hardness: "remediable" });
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    expectedDaysMin: 2,
    expectedDaysMax: 5,
  });
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    cac: "Not yet",
    asOf: AS_OF,
  });
  expect(res!.deadline).toEqual({ status: "infeasible", daysAvailable: 1 });
  expect(res!.planStatus).toBe("actionable");
  expect(res!.alternative?.title).toBe("Fixture alternative");
});

test("a three-day window inside a two-to-five-day estimate is at-risk", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: AS_OF + 3 * DAY });
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered", hardness: "remediable" });
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    expectedDaysMin: 2,
    expectedDaysMax: 5,
  });
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    cac: "Not yet",
    asOf: AS_OF,
  });
  expect(res!.deadline).toEqual({ status: "at-risk", daysAvailable: 3 });
});

test("no deadline gives unknown feasibility with null days", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: undefined });
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered", hardness: "remediable" });
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    expectedDaysMin: 2,
    expectedDaysMax: 5,
  });
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    cac: "Not yet",
    asOf: AS_OF,
  });
  expect(res!.deadline).toEqual({ status: "unknown", daysAvailable: null });
});

test("inverted estimates give unknown feasibility", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: AS_OF + 10 * DAY });
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered", hardness: "remediable" });
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    expectedDaysMin: 5,
    expectedDaysMax: 2,
  });
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    cac: "Not yet",
    asOf: AS_OF,
  });
  expect(res!.deadline.status).toBe("unknown");
  expect(res!.deadline.daysAvailable).toBe(10);
});

test("fully ready yields planStatus ready with no gap or action", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered" });
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    cac: "Registered",
    asOf: AS_OF,
  });
  expect(res!.overall).toBe("ready");
  expect(res!.planStatus).toBe("ready");
  expect(res!.gap).toBeNull();
  expect(res!.action).toBeNull();
  expect(res!.alternative).toBeNull();
  expect(res!.deadline).toEqual({ status: "unknown", daysAvailable: null });
});

test("no criteria is needs-information, never labelled ready", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  const res = await t.query(api.opportunities.getReadinessPlan, { id, asOf: AS_OF });
  expect(res!.overall).toBe("needs-information");
  expect(res!.planStatus).toBe("needs-information");
  expect(res!.gap).toBeNull();
  expect(res!.action).toBeNull();
});

test("a past deadline is infeasible with zero days and an alternative", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: AS_OF });
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered", hardness: "remediable" });
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    expectedDaysMin: 2,
    expectedDaysMax: 5,
  });
  const res = await t.query(api.opportunities.getReadinessPlan, {
    id,
    cac: "Not yet",
    asOf: AS_OF,
  });
  expect(res!.deadline).toEqual({ status: "infeasible", daysAvailable: 0 });
  expect(res!.alternative).not.toBeNull();
});

test("an unknown gap without a guide yields needs-information and no action", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, { criterionKey: "cac-registered" });
  const res = await t.query(api.opportunities.getReadinessPlan, { id, asOf: AS_OF });
  expect(res!.gap?.result).toBe("unknown");
  expect(res!.planStatus).toBe("needs-information");
  expect(res!.action).toBeNull();
});

test("same-priority gaps are selected by lexical criterionKey", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "zzz", status: "supported" });
  await insertEvidence(t, id, { claimKey: "aaa", status: "supported" });
  await insertCriterion(t, id, {
    criterionKey: "zzz",
    profileField: "state",
    operator: "one-of",
    expectedValues: ["Lagos"],
  });
  await insertCriterion(t, id, {
    criterionKey: "aaa",
    profileField: "state",
    operator: "one-of",
    expectedValues: ["Lagos"],
  });
  const res = await t.query(api.opportunities.getReadinessPlan, { id, asOf: AS_OF });
  expect(res!.gap?.criterionKey).toBe("aaa");
});

test("hidden and untrusted opportunities return null", async () => {
  const t = convexTest(schema, modules);
  const hiddenId = await insertOpportunity(t, { catalogVisibility: "hidden" });
  expect(
    await t.query(api.opportunities.getReadinessPlan, { id: hiddenId, asOf: AS_OF }),
  ).toBeNull();
  const untrustedId = await insertOpportunity(t, {
    sourceUrl: "https://example.ng",
    contacts: { officialLink: "https://example.ng" },
  });
  expect(
    await t.query(api.opportunities.getReadinessPlan, { id: untrustedId, asOf: AS_OF }),
  ).toBeNull();
});
