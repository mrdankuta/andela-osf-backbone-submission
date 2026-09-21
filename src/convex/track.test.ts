/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { seededGlow } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("GLOW works end to end: detail, save, checklist, tracking", async () => {
  const t = convexTest(schema, modules);
  const glow = await seededGlow(t);
  expect(glow.title).toContain("GLOW");
  const detail = await t.query(api.opportunities.getById, { id: glow._id });
  expect(detail?.title).toBe(glow.title);
  const dev = "e2e-device";
  await t.mutation(api.track.save, { opportunityId: glow._id, deviceId: dev });
  await t.mutation(api.track.tick, { opportunityId: glow._id, deviceId: dev, step: 1 });
  const rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows.length).toBe(1);
  expect(rows[0].opportunity._id).toBe(glow._id);
  expect(rows[0].progress).toBe(50);
  expect(rows[0].nextStep).toBe("Open the GLOW portal");
});

test("save tick progress and applied flow", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const id = items[0]._id;
  const dev = "test-device-1";
  await t.mutation(api.track.save, { opportunityId: id, deviceId: dev });
  await t.mutation(api.track.tick, { opportunityId: id, deviceId: dev, step: 1 });
  await t.mutation(api.track.tick, { opportunityId: id, deviceId: dev, step: 2 });
  const rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows.length).toBe(1);
  expect(rows[0].progress).toBeGreaterThan(0);
  expect(rows[0].nextStep).toBeTruthy();
  await t.mutation(api.track.markApplied, { opportunityId: id, deviceId: dev });
  const after = await t.query(api.track.list, { deviceId: dev });
  expect(after[0].status).toBe("applied");
});

test("tick toggles last-write-wins", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const dev = "test-device-2";
  await t.mutation(api.track.tick, { opportunityId: items[0]._id, deviceId: dev, step: 1 });
  await t.mutation(api.track.tick, { opportunityId: items[0]._id, deviceId: dev, step: 1 });
  const rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows[0].ticked).toEqual([]);
});

test("tracked hidden records are omitted from list but removable", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const dev = "test-device-3";
  await t.mutation(api.track.save, { opportunityId: items[0]._id, deviceId: dev });
  await t.run(async (ctx) => {
    await ctx.db.patch("opportunities", items[0]._id, { catalogVisibility: "hidden" });
  });
  const rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows.length).toBe(0);
  expect(await t.mutation(api.track.remove, { opportunityId: items[0]._id, deviceId: dev })).toBe(true);
});
