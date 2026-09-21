/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

async function appliedFixture(t: ReturnType<typeof convexTest>, device: string) {
  const id = await seededGlowId(t);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: device });
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: device, state: "ready" });
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: device, state: "applying" });
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: device, state: "applied" });
  return id;
}

test("stories submit from applied state only", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-1" });
  await expect(
    t.mutation(api.successStories.submitStory, { ownerKey: "dev-1", opportunityId: id, story: "It worked great for me." }),
  ).rejects.toThrow(/applied/);
  const applied = await appliedFixture(t, "dev-2");
  await expect(
    t.mutation(api.successStories.submitStory, { ownerKey: "dev-2", opportunityId: applied, story: "Short." }),
  ).rejects.toThrow(/20 characters/);
});

test("pending stories stay invisible until approved", async () => {
  const t = convexTest(schema, modules);
  const id = await appliedFixture(t, "dev-1");
  const storyId = await t.mutation(api.successStories.submitStory, {
    ownerKey: "dev-1",
    opportunityId: id,
    story: "GLOW funded my tailoring shop expansion in three weeks.",
  });
  expect(await t.query(api.successStories.publishedStories, { opportunityId: id })).toEqual([]);
  await t.mutation(api.successStories.reviewStory, { storyId, approved: true });
  const published = await t.query(api.successStories.publishedStories, { opportunityId: id });
  expect(published).toHaveLength(1);
  expect(published[0].story).toMatch(/tailoring shop/);
  expect(published[0]).not.toHaveProperty("ownerKey");
});

test("rejected stories never publish and owners can delete", async () => {
  const t = convexTest(schema, modules);
  const id = await appliedFixture(t, "dev-1");
  const storyId = await t.mutation(api.successStories.submitStory, {
    ownerKey: "dev-1",
    opportunityId: id,
    story: "This one should not appear publicly at all.",
  });
  await t.mutation(api.successStories.reviewStory, { storyId, approved: false });
  expect(await t.query(api.successStories.publishedStories, { opportunityId: id })).toEqual([]);
  expect(await t.mutation(api.successStories.deleteStory, { ownerKey: "dev-1", storyId })).toBe(true);
  expect(await t.query(api.successStories.myStories, { ownerKey: "dev-1" })).toEqual([]);
});

test("stories are isolated across users", async () => {
  const t = convexTest(schema, modules);
  const id = await appliedFixture(t, "dev-1");
  await t.mutation(api.successStories.submitStory, {
    ownerKey: "dev-1",
    opportunityId: id,
    story: "My private success story here.",
  });
  expect(await t.query(api.successStories.myStories, { ownerKey: "dev-2" })).toEqual([]);
  expect(
    await t.mutation(api.successStories.deleteStory, {
      ownerKey: "dev-2",
      storyId: (await t.query(api.successStories.myStories, { ownerKey: "dev-1" }))[0]._id,
    }),
  ).toBeNull();
});
