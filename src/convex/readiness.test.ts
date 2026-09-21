/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Doc, Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

async function glowId(t: ReturnType<typeof convexTest>): Promise<Id<"opportunities">> {
  const items = await t.query(api.opportunities.list, {});
  const glow = items.find((o) => o.title.includes("GLOW"));
  expect(glow).toBeDefined();
  return glow!._id;
}

async function insertEvidence(
  t: ReturnType<typeof convexTest>,
  opportunityId: Id<"opportunities">,
  overrides: Partial<Doc<"opportunityEvidence">> & { claimKey: string; status: Doc<"opportunityEvidence">["status"] },
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
      checkedAt: Date.now(),
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

test("seeded GLOW: met women criterion, pending location evidence, overall needs-information", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  const res = await t.query(api.opportunities.evaluateReadiness, {
    id,
    womenLed: true,
    state: "Lagos",
  });
  expect(res).not.toBeNull();
  expect(res!.overall).toBe("needs-information");
  expect(res!.assessments).toHaveLength(2);

  const women = res!.assessments.find((a) => a.criterionKey === "women-owned-business");
  expect(women?.result).toBe("met");
  expect(women?.profileValue).toBe(true);
  expect(women?.evidence?.status).toBe("supported");
  expect(women?.evidence?.sourceUrl).toBe("https://iprogrammes.boi.ng/");
  expect(women?.evidence?.sourcePassage).toContain("women-owned businesses");

  const nigeria = res!.assessments.find((a) => a.criterionKey === "business-in-nigeria");
  expect(nigeria?.result).toBe("needs-evidence");
  expect(nigeria?.profileValue).toBe("Lagos");
  expect(nigeria?.evidence?.status).toBe("pending-review");

  const keys = res!.assessments.map((a) => a.criterionKey);
  expect(keys).toEqual([...keys].sort());
});

test("hard unmet wins over pending evidence for overall", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  const res = await t.query(api.opportunities.evaluateReadiness, {
    id,
    womenLed: false,
    state: "Lagos",
  });
  expect(res!.overall).toBe("not-currently-eligible");
  const women = res!.assessments.find((a) => a.criterionKey === "women-owned-business");
  expect(women?.result).toBe("unmet");
});

test("missing facts give unknown or needs-evidence by evidence-first order", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await glowId(t);
  const res = await t.query(api.opportunities.evaluateReadiness, { id });
  expect(res!.overall).toBe("needs-information");
  const women = res!.assessments.find((a) => a.criterionKey === "women-owned-business");
  expect(women?.result).toBe("unknown");
  expect(women?.profileValue).toBeNull();
  const nigeria = res!.assessments.find((a) => a.criterionKey === "business-in-nigeria");
  expect(nigeria?.result).toBe("needs-evidence");
  expect(nigeria?.profileValue).toBeNull();
});

test("contradicted evidence makes the criterion ambiguous", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "contradicted" });
  await insertCriterion(t, id, { criterionKey: "cac-registered" });
  const res = await t.query(api.opportunities.evaluateReadiness, { id, cac: "Registered" });
  expect(res!.overall).toBe("needs-information");
  expect(res!.assessments[0].result).toBe("ambiguous");
});

test("a contradicted row cannot be hidden by an earlier supported row", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertEvidence(t, id, {
    claimKey: "cac-registered",
    status: "contradicted",
    checkedAt: Date.now() + 1000,
  });
  await insertCriterion(t, id, { criterionKey: "cac-registered" });
  const res = await t.query(api.opportunities.evaluateReadiness, { id, cac: "Registered" });
  expect(res!.assessments[0].result).toBe("ambiguous");
  expect(res!.assessments[0].evidence?.status).toBe("contradicted");
  expect(res!.overall).toBe("needs-information");
});

test("one-of criterion matches an allowed value", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "state", status: "supported" });
  await insertCriterion(t, id, {
    criterionKey: "state",
    profileField: "state",
    operator: "one-of",
    expectedValues: ["Lagos", "Kano"],
  });
  const res = await t.query(api.opportunities.evaluateReadiness, { id, state: "Kano" });
  expect(res!.assessments[0].result).toBe("met");
  expect(res!.overall).toBe("ready");
});

test("remediable unmet composes can-become-ready", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "cac-registered", status: "supported" });
  await insertCriterion(t, id, {
    criterionKey: "cac-registered",
    hardness: "remediable",
    guidance: "Register with CAC.",
  });
  const res = await t.query(api.opportunities.evaluateReadiness, { id, cac: "Not yet" });
  expect(res!.assessments[0].result).toBe("unmet");
  expect(res!.overall).toBe("can-become-ready");
});

test("all supported criteria met composes ready", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id, { claimKey: "women", status: "supported" });
  await insertEvidence(t, id, { claimKey: "state", status: "supported" });
  await insertCriterion(t, id, {
    criterionKey: "women",
    profileField: "womenLed",
    expectedValues: ["true"],
  });
  await insertCriterion(t, id, {
    criterionKey: "state",
    profileField: "state",
    operator: "one-of",
    expectedValues: ["Lagos", "Kano"],
  });
  const res = await t.query(api.opportunities.evaluateReadiness, {
    id,
    womenLed: true,
    state: "Lagos",
  });
  expect(res!.overall).toBe("ready");
  expect(res!.assessments.every((a) => a.result === "met")).toBe(true);
});

test("no criteria means needs-information with empty assessments", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  const res = await t.query(api.opportunities.evaluateReadiness, { id, state: "Lagos" });
  expect(res).not.toBeNull();
  expect(res!.overall).toBe("needs-information");
  expect(res!.assessments).toEqual([]);
});

test("hidden and untrusted opportunities return null", async () => {
  const t = convexTest(schema, modules);
  const hiddenId = await insertOpportunity(t, { catalogVisibility: "hidden" });
  expect(await t.query(api.opportunities.evaluateReadiness, { id: hiddenId })).toBeNull();
  const untrustedId = await insertOpportunity(t, {
    sourceUrl: "https://example.ng",
    contacts: { officialLink: "https://example.ng" },
  });
  expect(await t.query(api.opportunities.evaluateReadiness, { id: untrustedId })).toBeNull();
});
