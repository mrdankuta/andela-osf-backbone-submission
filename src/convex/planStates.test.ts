/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const DAY = 86400000;

async function glowId(t: ReturnType<typeof convexTest>) {
  return seededGlowId(t);
}

test("legacy saved and in-progress rows keep working as plans", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("track", {
      opportunityId: id,
      deviceId: "legacy",
      ticked: [1],
      status: "saved",
      updatedAt: AS_OF,
    });
    await ctx.db.insert("track", {
      opportunityId: id,
      deviceId: "legacy2",
      ticked: [],
      status: "in-progress",
      updatedAt: AS_OF,
    });
  });
  const rows = await t.query(api.track.list, { deviceId: "legacy" });
  expect(rows[0].displayState).toBe("qualifying");
  expect(rows[0].ticked).toEqual([1]);
  expect(rows[0].readinessOverall).toBeTruthy();
  expect(rows[0].deadlineRisk).toBeTruthy();
  const rows2 = await t.query(api.track.list, { deviceId: "legacy2" });
  expect(rows2[0].displayState).toBe("applying");
});

test("plan rows expose readiness, dependency, and deadline risk", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "plan1" });
  const rows = await t.query(api.track.list, { deviceId: "plan1", asOf: AS_OF });
  expect(rows[0].displayState).toBe("qualifying");
  expect(rows[0].nextDependency?.label).toBeTruthy();
  expect(rows[0].nextDependency?.guidance).toBeTruthy();
  expect(["on-track", "at-risk", "infeasible", "overdue", "unknown"]).toContain(rows[0].deadlineRisk);
});

test("state transitions follow the plan machine", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  const dev = "plan2";
  await t.mutation(api.track.save, { opportunityId: id, deviceId: dev });
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: dev, state: "ready" });
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: dev, state: "applying" });
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: dev, state: "applied" });
  let rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows[0].displayState).toBe("applied");
  await expect(
    t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: dev, state: "ready" }),
  ).rejects.toThrow(/Cannot move from applied/);
});

test("abandoning needs a reason and can be revived", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  const dev = "plan3";
  await t.mutation(api.track.save, { opportunityId: id, deviceId: dev });
  await expect(
    t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: dev, state: "abandoned" }),
  ).rejects.toThrow(/why/);
  await t.mutation(api.track.setPlanState, {
    opportunityId: id,
    deviceId: dev,
    state: "abandoned",
    abandonReason: "Deadline passed",
  });
  let rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows[0].displayState).toBe("abandoned");
  expect(rows[0].abandonReason).toBe("Deadline passed");
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: dev, state: "qualifying" });
  rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows[0].displayState).toBe("qualifying");
  expect(rows[0].abandonReason).toBeUndefined();
});

test("completing a guide keeps checklist history", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  const dev = "plan4";
  await t.mutation(api.track.save, {
    opportunityId: id,
    deviceId: dev,
    guideCriterionKey: "business-in-nigeria",
    guideTitle: "Confirm location",
  });
  await t.mutation(api.track.tick, { opportunityId: id, deviceId: dev, step: 1 });
  const done = await t.mutation(api.track.completeGuide, { opportunityId: id, deviceId: dev });
  expect(done.ticksPreserved).toBe(1);
  expect(done.guideDoneAt).toBeGreaterThan(0);
  const rows = await t.query(api.track.list, { deviceId: dev });
  expect(rows[0].ticked).toEqual([1]);
  expect(rows[0].guideDoneAt).toBe(done.guideDoneAt);
  await expect(
    t.mutation(api.track.completeGuide, { opportunityId: id, deviceId: "stranger" }),
  ).rejects.toThrow(/before completing/);
});

test("overdue plans surface deadline risk", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.run(async (ctx) => {
    await ctx.db.patch("opportunities", id, { deadline: AS_OF - 2 * DAY });
  });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "plan5" });
  const rows = await t.query(api.track.list, { deviceId: "plan5", asOf: AS_OF });
  expect(rows[0].deadlineRisk).toBe("overdue");
});

test("signed-out devices keep anonymous track access (no sign-in wall)", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "anon-device" });
  const rows = await t.query(api.track.list, { deviceId: "anon-device" });
  expect(rows.length).toBe(1);
  expect(rows[0].displayState).toBe("qualifying");
});
