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

async function grantedPair(
  t: ReturnType<typeof convexTest>,
  scopes: ("plan:view" | "plan:update" | "answers:confirm" | "documents:view")[] = ["plan:view", "plan:update"],
) {
  const id = await glowId(t);
  await asIdentity(t, "user", "user:ada");
  const { code } = await t.mutation(api.adviser.createInvite, {
    label: "SMEDAN mentor",
    scopes,
    opportunityIds: [],
  });
  await t.mutation(api.profiles.save, { ownerKey: "ada", state: "Lagos" });
  await asIdentity(t, "user", "user:temi");
  const { grantId, entrepreneurKey } = await t.mutation(api.adviser.redeemInvite, { code });
  expect(entrepreneurKey).toBe("user:ada");
  await asIdentity(t, undefined);
  return { id, grantId, code };
}

test("no consent means no access", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:temi");
  await expect(t.query(api.adviser.adviserPlans, { entrepreneurKey: "user:ada" })).rejects.toThrow(
    /No active consent/,
  );
  await expect(
    t.mutation(api.adviser.adviserTick, { entrepreneurKey: "user:ada", opportunityId: id, step: 1 }),
  ).rejects.toThrow(/No active consent/);
  await asIdentity(t, undefined);
});

test("view scope reads plans but cannot update", async () => {
  const t = convexTest(schema, modules);
  const { id } = await grantedPair(t, ["plan:view"]);
  await asIdentity(t, "user", "user:temi");
  const plans = await t.query(api.adviser.adviserPlans, { entrepreneurKey: "user:ada" });
  expect(Array.isArray(plans)).toBe(true);
  const plan = await t.query(api.adviser.adviserReadiness, { entrepreneurKey: "user:ada", opportunityId: id });
  expect(plan?.overall).toBeTruthy();
  await expect(
    t.mutation(api.adviser.adviserTick, { entrepreneurKey: "user:ada", opportunityId: id, step: 1 }),
  ).rejects.toThrow(/plan:update/);
  await asIdentity(t, undefined);
});

test("updates attribute to the adviser and keep history", async () => {
  const t = convexTest(schema, modules);
  const { id, grantId } = await grantedPair(t, ["plan:view", "plan:update"]);
  await asIdentity(t, "user", "user:temi");
  await t.mutation(api.adviser.adviserTick, { entrepreneurKey: "user:ada", opportunityId: id, step: 1 });
  await t.mutation(api.adviser.adviserSetPlanState, {
    entrepreneurKey: "user:ada",
    opportunityId: id,
    state: "ready",
  });
  await asIdentity(t, "user", "user:ada");
  const plans = await t.query(api.track.list, { deviceId: "whatever" });
  expect(plans[0].ticked).toEqual([1]);
  expect(plans[0].displayState).toBe("ready");
  const grants = await t.query(api.adviser.myGrants, {});
  expect(grants).toHaveLength(1);
  await t.mutation(api.adviser.revokeGrant, { grantId });
  const after = await t.query(api.adviser.myGrants, {});
  expect(after[0].status).toBe("revoked");
  await asIdentity(t, "user", "user:temi");
  await expect(t.query(api.adviser.adviserPlans, { entrepreneurKey: "user:ada" })).rejects.toThrow(
    /No active consent/,
  );
  await asIdentity(t, undefined);
});

test("opportunity scoping limits the grant", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  const other = await insertOpportunity(t, { title: "Other fund" });
  await asIdentity(t, "user", "user:ada");
  const { code } = await t.mutation(api.adviser.createInvite, {
    label: "Mentor",
    scopes: ["plan:view", "plan:update"],
    opportunityIds: [id],
  });
  await asIdentity(t, "user", "user:temi");
  await t.mutation(api.adviser.redeemInvite, { code });
  await expect(
    t.query(api.adviser.adviserReadiness, { entrepreneurKey: "user:ada", opportunityId: other }),
  ).rejects.toThrow(/does not cover/);
  const ok = await t.query(api.adviser.adviserReadiness, { entrepreneurKey: "user:ada", opportunityId: id });
  expect(ok?.overall).toBeTruthy();
  await asIdentity(t, undefined);
});

test("adviser answers land as overrides, never global facts", async () => {
  const t = convexTest(schema, modules);
  const { id } = await grantedPair(t, ["plan:view", "answers:confirm"]);
  await asIdentity(t, "user", "user:ada");
  await t.mutation(api.profiles.save, { ownerKey: "ada", cac: "Registered", source: "onboarding" });
  await asIdentity(t, "user", "user:temi");
  await t.mutation(api.adviser.adviserAnswer, {
    entrepreneurKey: "user:ada",
    opportunityId: id,
    profileField: "cac",
    value: "Not yet",
    valueType: "string",
  });
  const facts = await t.query(api.answerLedger.effectiveFacts, { ownerKey: "user:ada", opportunityId: id });
  void facts;
  await asIdentity(t, "user", "user:ada");
  expect((await t.query(api.profiles.get, { ownerKey: "ada" }))?.cac).toBe("Registered");
  const provenance = await t.query(api.answerLedger.answerProvenance, { ownerKey: "ada", opportunityId: id });
  expect(provenance.find((p) => p.field === "cac" && p.overridden)?.displayValue).toBe("Not yet");
  await asIdentity(t, undefined);
});

test("invites expire, redeem once, and never self-deal", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:ada");
  const { code } = await t.mutation(api.adviser.createInvite, { label: "M", scopes: ["plan:view"] });
  await t.run(async (ctx) => {
    const invite = await ctx.db.query("adviserInvites").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (invite) await ctx.db.patch("adviserInvites", invite._id, { createdAt: Date.now() - 8 * 86400000 });
  });
  await asIdentity(t, "user", "user:temi");
  await expect(t.mutation(api.adviser.redeemInvite, { code })).rejects.toThrow(/expired/);
  await asIdentity(t, "user", "user:ada");
  const fresh = await t.mutation(api.adviser.createInvite, { label: "M2", scopes: ["plan:view"] });
  await expect(t.mutation(api.adviser.redeemInvite, { code: fresh.code })).rejects.toThrow(/yourself/);
  await asIdentity(t, "user", "user:temi");
  await t.mutation(api.adviser.redeemInvite, { code: fresh.code });
  await asIdentity(t, "user", "user:ada");
  const fresh2 = await t.mutation(api.adviser.createInvite, { label: "M3", scopes: ["plan:view"] });
  await asIdentity(t, "user", "user:temi");
  await expect(t.mutation(api.adviser.redeemInvite, { code: fresh2.code })).rejects.toThrow(/already granted/);
  await asIdentity(t, undefined);
});

test("cross-organization pairs stay isolated", async () => {
  const t = convexTest(schema, modules);
  await grantedPair(t, ["plan:view"]);
  await asIdentity(t, "user", "user:ada");
  await t.mutation(api.profiles.save, { ownerKey: "ada", state: "Lagos" });
  await asIdentity(t, "user", "user:other-adviser");
  await expect(t.query(api.adviser.adviserPlans, { entrepreneurKey: "user:ada" })).rejects.toThrow(
    /No active consent/,
  );
  expect(await t.query(api.adviser.myAdvising, {})).toEqual([]);
  await asIdentity(t, "user", "user:temi");
  expect(await t.query(api.adviser.myAdvising, {})).toHaveLength(1);
  await asIdentity(t, undefined);
});

test("anonymous callers cannot touch adviser flows", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.adviser.createInvite, { label: "X", scopes: ["plan:view"] })).rejects.toThrow(
    /Sign in/,
  );
  await expect(t.query(api.adviser.myGrants, {})).rejects.toThrow(/Sign in/);
  await asIdentity(t, undefined);
});
