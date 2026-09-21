/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

async function asIdentity(
  t: ReturnType<typeof convexTest>,
  kind: "user" | "device" | undefined,
  id?: string,
) {
  await t.mutation(internal.identity._setTestIdentity, kind && id ? { kind, id } : {});
}

async function glowId(t: ReturnType<typeof convexTest>) {
  return seededGlowId(t);
}

test("outcomes record, revise, and carry provenance", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  const first = await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "x",
    opportunityId: id,
    outcome: "submitted",
  });
  let mine = await t.query(api.planOutcomes.myOutcomes, { ownerKey: "x" });
  expect(mine).toHaveLength(1);
  expect(mine[0].reportedBy).toBe("user");
  expect(mine[0].includeInLearning).toBe(true);
  const second = await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "x",
    opportunityId: id,
    outcome: "shortlisted",
  });
  expect(second).toBe(first);
  mine = await t.query(api.planOutcomes.myOutcomes, { ownerKey: "x" });
  expect(mine).toHaveLength(1);
  expect(mine[0].outcome).toBe("shortlisted");
  await asIdentity(t, undefined);
});

test("abandonment reasons stay optional, structured, and sensitive-free", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "x",
    opportunityId: id,
    outcome: "abandoned",
    reasonCode: "fees",
  });
  await expect(
    t.mutation(api.planOutcomes.recordOutcome, {
      ownerKey: "x",
      opportunityId: id,
      outcome: "rejected",
      reasonCode: "fees",
    }),
  ).rejects.toThrow(/does not apply/);
  await expect(
    t.mutation(api.planOutcomes.recordOutcome, {
      ownerKey: "x",
      opportunityId: id,
      outcome: "rejected",
      reasonCode: "other",
    }),
  ).rejects.toThrow(/one line/);
  await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "x",
    opportunityId: id,
    outcome: "rejected",
    reasonCode: "other",
    reasonOther: "Asked for items not listed.",
  });
  const mine = await t.query(api.planOutcomes.myOutcomes, { ownerKey: "x" });
  expect(mine[0].reasonOther).toBe("Asked for items not listed.");
  await asIdentity(t, undefined);
});

test("provider confirmation is distinguishable from user reports", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.planOutcomes.recordOutcome, { ownerKey: "x", opportunityId: id, outcome: "submitted" });
  await t.mutation(api.planOutcomes.confirmOutcome, { ownerKey: "user:alice", opportunityId: id, outcome: "funded" });
  const mine = await t.query(api.planOutcomes.myOutcomes, { ownerKey: "x" });
  expect(mine[0].outcome).toBe("funded");
  expect(mine[0].reportedBy).toBe("provider");
  await asIdentity(t, undefined);
});

test("outcomes can leave aggregate learning or be deleted", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.planOutcomes.recordOutcome, { ownerKey: "x", opportunityId: id, outcome: "rejected" });
  let insights = await t.query(api.planOutcomes.outcomeInsights, {});
  expect(insights).toEqual([{ outcome: "rejected", reasonCode: null, count: 1 }]);
  await t.mutation(api.planOutcomes.setOutcomeSharing, {
    ownerKey: "x",
    opportunityId: id,
    includeInLearning: false,
  });
  insights = await t.query(api.planOutcomes.outcomeInsights, {});
  expect(insights).toEqual([]);
  expect(await t.mutation(api.planOutcomes.deleteOutcome, { ownerKey: "x", opportunityId: id })).toBe(true);
  expect(await t.query(api.planOutcomes.myOutcomes, { ownerKey: "x" })).toEqual([]);
  await asIdentity(t, undefined);
});

test("outcomes are isolated across users", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.planOutcomes.recordOutcome, { ownerKey: "x", opportunityId: id, outcome: "funded" });
  await asIdentity(t, "user", "user:bob");
  expect(await t.query(api.planOutcomes.myOutcomes, { ownerKey: "y" })).toEqual([]);
  await asIdentity(t, undefined);
});

test("claim and delete-my-data carry outcomes", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.mutation(api.planOutcomes.recordOutcome, {
    ownerKey: "dev-o",
    opportunityId: id,
    outcome: "submitted",
  });
  await asIdentity(t, "user", "user:alice");
  const claimed = await t.mutation(api.profiles.claimDeviceData, { deviceId: "dev-o" });
  expect(claimed.outcomesMigrated).toBe(1);
  expect(await t.query(api.planOutcomes.myOutcomes, { ownerKey: "whatever" })).toHaveLength(1);
  const exported = await t.query(api.dataControls.exportMyData, {});
  expect(exported.outcomes).toHaveLength(1);
  expect(exported.outcomes[0].outcome).toBe("submitted");
  const deleted = await t.mutation(api.dataControls.deleteMyData, { confirmation: "DELETE" });
  expect(deleted.deleted.outcomes).toBe(1);
  expect(await t.query(api.planOutcomes.myOutcomes, { ownerKey: "whatever" })).toEqual([]);
  await asIdentity(t, undefined);
});
