/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Doc, Id } from "./_generated/dataModel";
import {
  alignGuideToGap,
  GUIDE_RELATED_CONFIDENCE,
  guideFreshness,
} from "./guideMatchPolicy";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const DAY = 86400000;

test("exact criterion hits win outright", () => {
  const guides = [
    { criterionKey: "other", family: "registration" },
    { criterionKey: "cac", family: "registration" },
  ];
  const match = alignGuideToGap({ criterionKey: "cac", family: "registration" }, guides, "Lagos");
  expect(match.outcome).toBe("exact");
  if (match.outcome !== "exact") return;
  expect(match.guide.criterionKey).toBe("cac");
  expect(match.confidence).toBe(1);
});

test("related matches prefer the user's state, then general guides", () => {
  const guides = [
    { criterionKey: "z-guide", family: "registration", appliesTo: ["Kano"] },
    { criterionKey: "a-guide", family: "registration", appliesTo: ["all"] },
  ];
  const lagos = alignGuideToGap({ criterionKey: "cac", family: "registration" }, guides, "Lagos");
  expect(lagos.outcome).toBe("related");
  if (lagos.outcome !== "related") return;
  expect(lagos.guide.criterionKey).toBe("a-guide");
  expect(lagos.confidence).toBe(GUIDE_RELATED_CONFIDENCE);
  expect(lagos.note).toMatch(/confirm it fits/);
  const kano = alignGuideToGap({ criterionKey: "cac", family: "registration" }, guides, "Kano");
  if (kano.outcome !== "related") return;
  expect(kano.guide.criterionKey).toBe("z-guide");
});

test("unrelated catalogs and family-less gaps are explicit no-matches", () => {
  const guides = [{ criterionKey: "cac", family: "registration" }];
  expect(alignGuideToGap({ criterionKey: "state", family: "geography" }, guides).outcome).toBe("none");
  expect(alignGuideToGap({ criterionKey: "state" }, guides).outcome).toBe("none");
});

test("freshness is computed, never assumed", () => {
  expect(guideFreshness({ lastChecked: AS_OF }, AS_OF).stale).toBe(false);
  const stale = guideFreshness({ lastChecked: AS_OF - 200 * DAY }, AS_OF);
  expect(stale.stale).toBe(true);
  if (stale.stale) expect(stale.note).toMatch(/200 days/);
  const missing = guideFreshness({}, AS_OF);
  expect(missing.stale).toBe(true);
  expect(missing.lastChecked).toBeNull();
});

async function gapFixture(t: ReturnType<typeof convexTest>) {
  const id = await insertOpportunity(t, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "cac-registered",
      displayValue: "CAC registered",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      checkedAt: AS_OF,
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "cac-registered",
      label: "CAC registered",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "Must be CAC registered.",
      hardness: "remediable",
      family: "registration",
      evidenceClaimKey: "cac-registered",
      guidance: "Register with CAC.",
    });
  });
  return id;
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
      costEstimate: "No cost is published.",
      dependencies: ["Business name search"],
      uncertainty: "Timelines vary.",
      alternativeTitle: "Compare another opportunity",
      alternativeDetail: "Look elsewhere.",
      ...rest,
    }),
  );
}

const facts = { cac: "Not yet" };

test("a correct guide matches exactly with freshness and coverage", async () => {
  const t = convexTest(schema, modules);
  const id = await gapFixture(t);
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    family: "registration",
    appliesTo: ["all"],
    lastChecked: AS_OF,
  });
  const plan = await t.query(api.opportunities.getReadinessPlan, { id, ...facts, asOf: AS_OF });
  expect(plan?.planStatus).toBe("actionable");
  expect(plan?.action?.matchConfidence).toBe(1);
  expect(plan?.action?.matchNote).toBeUndefined();
  expect(plan?.action?.stale).toBe(false);
  expect(plan?.action?.lastChecked).toBe(AS_OF);
  expect(plan?.action?.appliesTo).toEqual(["all"]);
  expect(plan?.action?.prerequisites).toEqual(["Business name search"]);
});

test("a closely related guide is flagged, never silent", async () => {
  const t = convexTest(schema, modules);
  const id = await gapFixture(t);
  await insertGuide(t, id, {
    criterionKey: "business-name-search",
    family: "registration",
    appliesTo: ["all"],
    lastChecked: AS_OF,
  });
  const plan = await t.query(api.opportunities.getReadinessPlan, { id, ...facts, asOf: AS_OF });
  expect(plan?.planStatus).toBe("actionable");
  expect(plan?.action?.matchConfidence).toBe(GUIDE_RELATED_CONFIDENCE);
  expect(plan?.action?.matchNote).toMatch(/confirm it fits/);
});

test("a stale guide carries its age honestly", async () => {
  const t = convexTest(schema, modules);
  const id = await gapFixture(t);
  await insertGuide(t, id, {
    criterionKey: "cac-registered",
    family: "registration",
    lastChecked: AS_OF - 200 * DAY,
  });
  const plan = await t.query(api.opportunities.getReadinessPlan, { id, ...facts, asOf: AS_OF });
  expect(plan?.action?.stale).toBe(true);
  expect(plan?.action?.title).toBe("Guide for cac-registered");
});

test("no suitable guide means no invented action", async () => {
  const t = convexTest(schema, modules);
  const id = await gapFixture(t);
  await insertGuide(t, id, { criterionKey: "unrelated-key", family: "revenue" });
  const plan = await t.query(api.opportunities.getReadinessPlan, { id, ...facts, asOf: AS_OF });
  expect(plan?.planStatus).toBe("needs-information");
  expect(plan?.action).toBeNull();
});

test("starting from a plan records the guide on the track row", async () => {
  const t = convexTest(schema, modules);
  const id = await gapFixture(t);
  await insertGuide(t, id, { criterionKey: "cac-registered", family: "registration", lastChecked: AS_OF });
  const plan = await t.query(api.opportunities.getReadinessPlan, { id, ...facts, asOf: AS_OF });
  const saved = await t.mutation(api.track.save, {
    opportunityId: id,
    deviceId: "d1",
    guideCriterionKey: plan?.gap?.criterionKey,
    guideTitle: plan?.action?.title,
  });
  expect(saved).toBe(true);
  const rows = await t.query(api.track.list, { deviceId: "d1" });
  expect(rows[0].guideTitle).toBe("Guide for cac-registered");
});
