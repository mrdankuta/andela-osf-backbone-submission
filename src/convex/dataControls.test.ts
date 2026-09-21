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

async function aliceSetup(t: ReturnType<typeof convexTest>) {
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Lagos", cac: "Registered" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "x" });
  await t.mutation(api.track.tick, { opportunityId: id, deviceId: "x", step: 1 });
  await t.run(async (ctx) =>
    ctx.db.insert("chatThreads", {
      opportunityId: id,
      deviceId: "user:alice",
      threadId: "local-user-alice-x",
      title: "GLOW",
      updatedAt: Date.now(),
    }),
  );
  return id;
}

test("inventory inspects private categories without Org data", async () => {
  const t = convexTest(schema, modules);
  await aliceSetup(t);
  const inv = await t.query(api.dataControls.inventory, {});
  expect(inv.profileFields).toContain("state");
  expect(inv.profileFields).toContain("cac");
  expect(inv.plans).toHaveLength(1);
  expect(inv.plans[0].status).toBe("applying");
  expect(inv.conversations).toHaveLength(1);
  await asIdentity(t, undefined);
});

test("export is portable and strictly your own", async () => {
  const t = convexTest(schema, modules);
  const id = await aliceSetup(t);
  const data = await t.query(api.dataControls.exportMyData, {});
  expect(data.exportedAt).toBeGreaterThan(0);
  expect(data.profile).toMatchObject({ state: "Lagos", cac: "Registered" });
  expect(data.plans).toHaveLength(1);
  expect(data.plans[0]).toMatchObject({ opportunityId: id, ticked: [1] });
  expect(data.conversations).toHaveLength(1);
  expect(JSON.stringify(data)).not.toContain("user:bob");
  // Bob sees none of it.
  await asIdentity(t, "user", "user:bob");
  expect((await t.query(api.dataControls.exportMyData, {})).plans).toHaveLength(0);
  expect(await t.query(api.dataControls.inventory, {})).toEqual({
    profileFields: [],
    plans: [],
    conversations: [],
  });
  await asIdentity(t, undefined);
});

test("deletion demands exact confirmation; anything else is intact", async () => {
  const t = convexTest(schema, modules);
  await aliceSetup(t);
  await asIdentity(t, "user", "user:alice");
  await expect(t.mutation(api.dataControls.deleteMyData, { confirmation: "delete" })).rejects.toThrow(
    /Type DELETE/,
  );
  await expect(t.mutation(api.dataControls.deleteMyData, { confirmation: "" })).rejects.toThrow(/Type DELETE/);
  expect((await t.query(api.dataControls.inventory, {})).plans).toHaveLength(1);
  await asIdentity(t, undefined);
});

test("deletion removes own records and preserves shared and other users data", async () => {
  const t = convexTest(schema, modules);
  const id = await aliceSetup(t);
  await asIdentity(t, "user", "user:bob");
  await t.mutation(api.profiles.save, { ownerKey: "y", state: "Kano" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "y" });
  await asIdentity(t, "user", "user:alice");
  const out = await t.mutation(api.dataControls.deleteMyData, { confirmation: "DELETE" });
  expect(out).toEqual({ deleted: { profile: true, plans: 1, conversations: 1, documents: 0, outcomes: 0 } });
  expect(await t.query(api.dataControls.inventory, {})).toEqual({
    profileFields: [],
    plans: [],
    conversations: [],
  });
  // Shared catalog untouched.
  expect(await t.query(api.opportunities.list, {})).toHaveLength(6);
  expect((await t.query(api.opportunities.getEvidence, { id }))?.claims.length).toBeGreaterThan(0);
  // Bob untouched.
  await asIdentity(t, "user", "user:bob");
  expect((await t.query(api.dataControls.exportMyData, {})).profile).toMatchObject({ state: "Kano" });
  await asIdentity(t, undefined);
});

test("anonymous callers cannot export, inspect, or delete", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.dataControls.inventory, {})).rejects.toThrow(/Sign in/);
  await expect(t.query(api.dataControls.exportMyData, {})).rejects.toThrow(/Sign in/);
  await expect(t.mutation(api.dataControls.deleteMyData, { confirmation: "DELETE" })).rejects.toThrow(
    /Sign in/,
  );
  await asIdentity(t, undefined);
});

test("device sweep clears leftover anonymous rows on request", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-left" });
  await asIdentity(t, "user", "user:alice");
  const out = await t.mutation(api.dataControls.deleteMyData, {
    confirmation: "DELETE",
    alsoDeviceId: "dev-left",
  });
  expect(out.deleted.plans).toBe(1);
  await asIdentity(t, undefined);
  await asIdentity(t, "device", "dev-left");
  expect(await t.query(api.track.list, { deviceId: "dev-left" })).toHaveLength(0);
  await asIdentity(t, undefined);
});
