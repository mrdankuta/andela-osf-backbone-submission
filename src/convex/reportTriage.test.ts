/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, seededGlowId } from "../test/convexFixtures";
import { routeReport } from "./reportPolicy";

const modules = import.meta.glob("./**/*.ts");

test("routing prioritizes high-risk, confidence follows specificity", () => {
  expect(routeReport({ category: "suspected-scam" })).toEqual({ priority: "now", confidence: "medium" });
  expect(routeReport({ category: "suspected-scam", claimKey: "fee" })).toEqual({ priority: "now", confidence: "high" });
  expect(routeReport({ category: "ended-program" })).toEqual({ priority: "now", confidence: "medium" });
  expect(routeReport({ category: "broken-source" })).toEqual({ priority: "now", confidence: "medium" });
  expect(routeReport({ category: "wrong-deadline", claimKey: "deadline" })).toEqual({ priority: "queue", confidence: "high" });
  expect(routeReport({ category: "other" })).toEqual({ priority: "queue", confidence: "low" });
});

async function seededId(t: ReturnType<typeof convexTest>) {
  return seededGlowId(t);
}

test("reports return a receipt with a recheck expectation", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  const receipt = await t.mutation(api.curation.report, {
    opportunityId: id,
    category: "suspected-scam",
    note: "Asks for a fee on WhatsApp.",
  });
  expect(receipt.category).toBe("suspected-scam");
  expect(receipt.priority).toBe("now");
  expect(receipt.duplicate).toBe(false);
  expect(receipt.recheckWithinHours).toBe(48);
  const status = await t.query(api.curation.reportStatus, { flagId: receipt.flagId });
  expect(status?.status).toBe("open");
  expect(status?.priority).toBe("now");
});

test("duplicate reports collapse with a count instead of new rows", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  const first = await t.mutation(api.curation.report, { opportunityId: id, category: "wrong-deadline" });
  const second = await t.mutation(api.curation.report, { opportunityId: id, category: "wrong-deadline" });
  expect(second.flagId).toBe(first.flagId);
  expect(second.duplicate).toBe(true);
  const queue = await t.query(api.curation.queue, {});
  expect(queue.length).toBe(1);
  expect(queue[0].duplicateCount).toBe(1);
  // A different category is a different report.
  await t.mutation(api.curation.report, { opportunityId: id, category: "broken-source" });
  expect(await t.query(api.curation.queue, {})).toHaveLength(2);
});

test("high-risk reports sort first in the curator queue", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  await t.mutation(api.curation.report, { opportunityId: id, category: "other", note: "Just wondering." });
  await t.mutation(api.curation.report, { opportunityId: id, category: "suspected-scam" });
  const queue = await t.query(api.curation.queue, {});
  expect(queue[0].category).toBe("suspected-scam");
  expect(queue[0].priority).toBe("now");
});

test("a confirmed ended program closes honestly", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  const receipt = await t.mutation(api.curation.report, { opportunityId: id, category: "ended-program" });
  const out = await t.mutation(api.curation.resolveReport, {
    flagId: receipt.flagId,
    outcome: "fixed",
    note: "Official page says closed.",
  });
  expect(out.effects).toContain("Opportunity marked expired.");
  const stored = await t.run(async (ctx) => ctx.db.get("opportunities", id));
  expect(stored?.status).toBe("expired");
  const status = await t.query(api.curation.reportStatus, { flagId: receipt.flagId });
  expect(status?.status).toBe("resolved");
  expect(status?.outcome).toBe("fixed");
});

test("a confirmed scam hides the listing", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  const receipt = await t.mutation(api.curation.report, { opportunityId: id, category: "suspected-scam" });
  await t.mutation(api.curation.resolveReport, { flagId: receipt.flagId, outcome: "fixed" });
  const stored = await t.run(async (ctx) => ctx.db.get("opportunities", id));
  expect(stored?.catalogVisibility).toBe("hidden");
  expect(await t.query(api.opportunities.list, {})).toHaveLength(5);
});

test("confirmed claim reports mark linked evidence for re-verification", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  const receipt = await t.mutation(api.curation.report, {
    opportunityId: id,
    category: "wrong-deadline",
    claimKey: "deadline",
  });
  const out = await t.mutation(api.curation.resolveReport, {
    flagId: receipt.flagId,
    outcome: "fixed",
    staleLinkedClaims: true,
  });
  expect(out.effects.join(" ")).toMatch(/marked for re-verification/);
  const evidence = await t.query(api.opportunities.getEvidence, { id });
  const deadlineRows = (evidence?.claims ?? []).filter((c) => c.claimKey === "deadline");
  expect(deadlineRows.length).toBeGreaterThan(0);
  expect(deadlineRows.every((c) => c.status === "pending-review")).toBe(true);
});

test("no-issue resolutions change nothing but the report", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  const receipt = await t.mutation(api.curation.report, { opportunityId: id, category: "wrong-deadline" });
  const out = await t.mutation(api.curation.resolveReport, { flagId: receipt.flagId, outcome: "no-issue" });
  expect(out.effects).toEqual([]);
  const stored = await t.run(async (ctx) => ctx.db.get("opportunities", id));
  expect(stored?.status).toBe("verified");
  expect(await t.query(api.curation.queue, {})).toHaveLength(0);
});

test("resolution records reviewer provenance", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  const receipt = await t.mutation(api.curation.report, { opportunityId: id, category: "other" });
  await t.mutation(api.curation.resolveReport, { flagId: receipt.flagId, outcome: "escalated", note: "Needs BOI call." });
  const stored = await t.run(async (ctx) => ctx.db.get("flags", receipt.flagId));
  expect(stored?.resolvedBy).toBe("test-env");
  expect(stored?.outcome).toBe("escalated");
  await expect(
    t.mutation(api.curation.resolveReport, { flagId: receipt.flagId, outcome: "fixed" }),
  ).rejects.toThrow(/already resolved/);
});
