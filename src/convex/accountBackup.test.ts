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

test("anonymous device use keeps working without an account", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.mutation(api.profiles.save, { ownerKey: "dev-1", state: "Lagos" });
  expect((await t.query(api.profiles.get, { ownerKey: "dev-1" }))?.state).toBe("Lagos");
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-1" });
  expect(await t.query(api.track.list, { deviceId: "dev-1" })).toHaveLength(1);
  await asIdentity(t, undefined);
});

test("reserved user: keys are rejected from callers", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.profiles.get, { ownerKey: "user:alice" })).rejects.toThrow(/Invalid identifier/);
  await expect(
    t.mutation(api.profiles.save, { ownerKey: "user:alice", state: "Lagos" }),
  ).rejects.toThrow(/Invalid identifier/);
  await asIdentity(t, undefined);
});

test("authenticated writes ignore the supplied key", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "whatever-device", state: "Kano" });
  expect((await t.query(api.profiles.get, { ownerKey: "ignored-too" }))?.state).toBe("Kano");
  await asIdentity(t, undefined);
  expect(await t.query(api.profiles.get, { ownerKey: "dev-1" })).toBeNull();
});

test("claiming merges device data into the account idempotently", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  // Anonymous device life first.
  await t.mutation(api.profiles.save, { ownerKey: "dev-9", state: "Lagos", cac: "Registered" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-9" });
  await t.mutation(api.track.tick, { opportunityId: id, deviceId: "dev-9", step: 1 });
  // Sign in and claim.
  await asIdentity(t, "user", "user:alice");
  const first = await t.mutation(api.profiles.claimDeviceData, { deviceId: "dev-9" });
  expect(first).toEqual({ profileMigrated: true, plansMigrated: 1, plansMerged: 0, threadsMigrated: 0, answersMigrated: 0, documentsMigrated: 0, outcomesMigrated: 0 });
  // Visible as the account on a second device.
  expect((await t.query(api.profiles.get, { ownerKey: "anything" }))?.state).toBe("Lagos");
  const rows = await t.query(api.track.list, { deviceId: "anything" });
  expect(rows).toHaveLength(1);
  expect(rows[0].ticked).toEqual([1]);
  // Idempotent second run.
  expect(await t.mutation(api.profiles.claimDeviceData, { deviceId: "dev-9" })).toEqual({
    profileMigrated: false,
    plansMigrated: 0,
    plansMerged: 0,
    threadsMigrated: 0,
    answersMigrated: 0,
    documentsMigrated: 0,
    outcomesMigrated: 0,
  });
  // Old device key sees nothing now.
  await asIdentity(t, undefined);
  await asIdentity(t, "device", "dev-9");
  expect(await t.query(api.profiles.get, { ownerKey: "dev-9" })).toBeNull();
  expect(await t.query(api.track.list, { deviceId: "dev-9" })).toHaveLength(0);
  await asIdentity(t, undefined);
});

test("merging fills only unset account fields and unions ticks", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:bob");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Kano", age: "25–35" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "x" });
  await t.mutation(api.track.tick, { opportunityId: id, deviceId: "x", step: 2 });
  await asIdentity(t, undefined);
  await t.mutation(api.profiles.save, { ownerKey: "dev-8", state: "Lagos", sector: "Tech" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-8" });
  await t.mutation(api.track.tick, { opportunityId: id, deviceId: "dev-8", step: 1 });
  await asIdentity(t, "user", "user:bob");
  const res = await t.mutation(api.profiles.claimDeviceData, { deviceId: "dev-8" });
  expect(res).toEqual({ profileMigrated: true, plansMigrated: 0, plansMerged: 1, threadsMigrated: 0, answersMigrated: 0, documentsMigrated: 0, outcomesMigrated: 0 });
  const profile = await t.query(api.profiles.get, { ownerKey: "x" });
  expect(profile?.state).toBe("Kano");
  expect(profile?.sector).toBe("Tech");
  const rows = await t.query(api.track.list, { deviceId: "x" });
  expect(rows[0].ticked).toEqual([1, 2]);
  await asIdentity(t, undefined);
});

test("another user cannot see or mutate your data", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Lagos" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "x" });
  await asIdentity(t, "user", "user:bob");
  expect(await t.query(api.profiles.get, { ownerKey: "whatever" })).toBeNull();
  expect(await t.query(api.track.list, { deviceId: "whatever" })).toHaveLength(0);
  // Bob's writes land on his own rows, never Alice's.
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "whatever" });
  await asIdentity(t, "user", "user:alice");
  const rows = await t.query(api.track.list, { deviceId: "whatever" });
  expect(rows).toHaveLength(1);
  expect(rows[0].ticked).toEqual([]);
  await asIdentity(t, undefined);
});

test("anonymous callers must sign in before claiming", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.profiles.claimDeviceData, { deviceId: "dev-1" })).rejects.toThrow(/Sign in/);
  await asIdentity(t, undefined);
});
