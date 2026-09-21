/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("flag publish resolves and stamps verified date", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  await t.mutation(api.curation.report, { opportunityId: id, category: "broken-source", note: "Apply button blank" });
  const q1 = await t.query(api.curation.queue, {});
  expect(q1.length).toBeGreaterThan(0);
  await t.mutation(api.curation.publish, { opportunityId: id });
  const q2 = await t.query(api.curation.queue, {});
  expect(q2.find((f) => f.opportunityId === id)).toBeUndefined();
  const opp = await t.query(api.opportunities.getById, { id });
  expect(opp?.status).toBe("verified");
});
