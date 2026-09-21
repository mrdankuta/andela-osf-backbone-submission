/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("dueForDevice returns nothing for GLOW because no deadline is published", async () => {
  const t = convexTest(schema, modules);
  const glowId = await seededGlowId(t);
  const dev = "rem-1";
  await t.mutation(api.profiles.save, { ownerKey: dev, reminderDays: [30, 7, 1] });
  await t.mutation(api.track.save, { opportunityId: glowId, deviceId: dev });
  const due = await t.query(api.reminders.dueForDevice, { deviceId: dev });
  expect(due.length).toBe(0);
});

test("dueForDevice surfaces dated items within reminder window", async () => {
  const t = convexTest(schema, modules);
  const dev = "rem-1b";
  const id = await insertOpportunity(t, { deadline: Date.now() + 5 * 86400000 });
  await t.mutation(api.profiles.save, { ownerKey: dev, reminderDays: [30, 7, 1] });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: dev });
  const due = await t.query(api.reminders.dueForDevice, { deviceId: dev });
  expect(due.length).toBe(1);
  expect(due[0].daysLeft).toBe(5);
});

test("scanDue finds expiring tracked items", async () => {
  const t = convexTest(schema, modules);
  const left = 4;
  const id = await insertOpportunity(t, { deadline: Date.now() + left * 86400000 });
  await t.mutation(api.profiles.save, { ownerKey: "rem-2", reminderDays: [left] });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "rem-2" });
  const found = await t.query(internal.reminders.scanDue, {});
  expect(found.length).toBe(1);
  expect(found[0].daysLeft).toBe(left);
});

test("remove deletes tracked item", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  await t.mutation(api.track.save, { opportunityId: items[0]._id, deviceId: "rem-3" });
  await t.mutation(api.track.remove, { opportunityId: items[0]._id, deviceId: "rem-3" });
  const rows = await t.query(api.track.list, { deviceId: "rem-3" });
  expect(rows.length).toBe(0);
});
