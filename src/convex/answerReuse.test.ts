/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86400000;

async function asIdentity(
  t: ReturnType<typeof convexTest>,
  kind: "user" | "device" | undefined,
  id?: string,
) {
  await t.mutation(internal.identity._setTestIdentity, kind && id ? { kind, id } : {});
}

async function twoOpps(t: ReturnType<typeof convexTest>) {
  const a = await insertOpportunity(t, { title: "First grant" });
  const b = await insertOpportunity(t, { title: "Second grant" });
  return [a, b] as const;
}

test("confirmed answers record question, value, and time", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", cac: "Registered", source: "onboarding" });
  const provenance = await t.query(api.answerLedger.answerProvenance, { ownerKey: "x" });
  expect(provenance).toHaveLength(1);
  expect(provenance[0]).toMatchObject({
    field: "cac",
    displayValue: "Registered",
    source: "onboarding",
    sourceLabel: "Onboarding",
    overridden: false,
    stale: false,
  });
  await asIdentity(t, undefined);
});

test("a second opportunity proposes reuse with provenance", async () => {
  const t = convexTest(schema, modules);
  const [a, b] = await twoOpps(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, {
    ownerKey: "x",
    cac: "Registered",
    source: "intake",
    sourceOpportunityId: a,
  });
  const provenance = await t.query(api.answerLedger.answerProvenance, { ownerKey: "x", opportunityId: b });
  expect(provenance[0].sourceLabel).toMatch(/First grant intake/);
  const facts = await t.query(api.answerLedger.effectiveFacts, { ownerKey: "x", opportunityId: b });
  expect(facts.cac).toBe("Registered");
  await asIdentity(t, undefined);
});

test("opportunity overrides never corrupt the reusable fact", async () => {
  const t = convexTest(schema, modules);
  const [a, b] = await twoOpps(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", cac: "Registered", source: "onboarding" });
  await t.mutation(api.answerLedger.setAnswerOverride, {
    ownerKey: "x",
    opportunityId: b,
    profileField: "cac",
    value: "Not yet",
    valueType: "string",
  });
  const forB = await t.query(api.answerLedger.effectiveFacts, { ownerKey: "x", opportunityId: b });
  expect(forB.cac).toBe("Not yet");
  const forA = await t.query(api.answerLedger.effectiveFacts, { ownerKey: "x", opportunityId: a });
  expect(forA.cac).toBe("Registered");
  expect((await t.query(api.profiles.get, { ownerKey: "x" }))?.cac).toBe("Registered");
  const provenance = await t.query(api.answerLedger.answerProvenance, { ownerKey: "x", opportunityId: b });
  const fields = provenance.filter((p) => p.field === "cac");
  expect(fields.find((p) => p.overridden)?.displayValue).toBe("Not yet");
  expect(fields.find((p) => !p.overridden)?.displayValue).toBe("Registered");
  await t.mutation(api.answerLedger.clearAnswerOverride, { ownerKey: "x", opportunityId: b, profileField: "cac" });
  expect((await t.query(api.answerLedger.effectiveFacts, { ownerKey: "x", opportunityId: b })).cac).toBe(
    "Registered",
  );
  await asIdentity(t, undefined);
});

test("stale answers ask for confirmation", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Lagos", source: "onboarding" });
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("answerLedger")
      .withIndex("by_owner_field", (q) => q.eq("ownerKey", "user:alice").eq("profileField", "state"))
      .unique();
    if (row) await ctx.db.patch("answerLedger", row._id, { confirmedAt: Date.now() - 200 * DAY });
  });
  const provenance = await t.query(api.answerLedger.answerProvenance, { ownerKey: "x" });
  expect(provenance[0].stale).toBe(true);
  await asIdentity(t, undefined);
});

test("answers are isolated across users", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", cac: "Registered", source: "onboarding" });
  await asIdentity(t, "user", "user:bob");
  expect(await t.query(api.answerLedger.answerProvenance, { ownerKey: "y" })).toEqual([]);
  expect((await t.query(api.answerLedger.effectiveFacts, { ownerKey: "y" })).cac).toBeUndefined();
  await asIdentity(t, undefined);
});

test("overrides validate field and opportunity", async () => {
  const t = convexTest(schema, modules);
  const [a] = await twoOpps(t);
  await asIdentity(t, "user", "user:alice");
  await expect(
    t.mutation(api.answerLedger.setAnswerOverride, {
      ownerKey: "x",
      opportunityId: a,
      profileField: "needs",
      value: "x",
      valueType: "string",
    }),
  ).rejects.toThrow(/readiness facts/);
  await asIdentity(t, undefined);
});
