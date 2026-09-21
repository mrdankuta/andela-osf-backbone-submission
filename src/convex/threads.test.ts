/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("one thread per opportunity; conversation list grows", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const secondId = await insertOpportunity(t, { title: "BOI Second Fixture" });
  const dev = "chat-device-1";

  const a = await t.mutation(api.backboneAgent.ensureThreadForOpportunity, {
    opportunityId: items[0]._id,
    deviceId: dev,
  });
  expect(a.threadId.length).toBeGreaterThan(0);

  // Same opportunity reuses its thread
  const a2 = await t.mutation(api.backboneAgent.ensureThreadForOpportunity, {
    opportunityId: items[0]._id,
    deviceId: dev,
  });
  expect(a2.threadId).toBe(a.threadId);

  // Different opportunity gets its own thread
  const b = await t.mutation(api.backboneAgent.ensureThreadForOpportunity, {
    opportunityId: secondId,
    deviceId: dev,
  });
  expect(b.threadId).not.toBe(a.threadId);

  const threads = await t.query(api.backboneAgent.listThreads, { deviceId: dev });
  expect(threads.length).toBe(2);
  expect(threads[0].title.length).toBeGreaterThan(0);
});

test("local fallback threads return empty agent history", async () => {
  const t = convexTest(schema, modules);
  const hist = await t.query(api.backboneAgent.listMessages, { threadId: "local-dev-x" });
  expect(hist).toEqual([]);
});
