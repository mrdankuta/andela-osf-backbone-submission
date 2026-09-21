/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("agent definition loads with Backbone instructions", async () => {
  const { backbone } = await import("./agentDef");
  expect(backbone).toBeTruthy();
});

test("explain fallback stays cited without gateway", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  const r = await t.query(api.assistant.explain, { id, mode: "Yoruba" });
  expect(r?.text.length).toBeGreaterThan(10);
  expect(r?.citation).toMatch(/Source:/);
});
