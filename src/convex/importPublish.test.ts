/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { draftFieldKeys } from "./importDrafts";
import { emailAllowed, resolveCuratorAccess } from "./curation";

const modules = import.meta.glob("./**/*.ts");

function htmlPage() {
  return [
    "<html><head><title>BOI Youth Fund</title></head><body>",
    "<p>A ₦5 billion fund for young entrepreneurs with training and mentorship.</p>",
    "<p>To be eligible, applicants must be aged 18–35 and CAC registered.</p>",
    "<p>Applications close on 20 June 2027. Apply at https://youth.boi.ng/apply.</p>",
    "<p>The programme is now open. Reach us at youth@boi.ng.</p>",
    "</body></html>",
  ].join("\n");
}

async function capture(t: ReturnType<typeof convexTest>, fetchImpl: () => Promise<unknown>) {
  const { vi } = await import("vitest");
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  try {
    return await t.action(api.importDrafts.requestImport, { sourceUrl: "https://youth.boi.ng/fund" });
  } finally {
    vi.unstubAllGlobals();
  }
}

function okFetch() {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    text: async () => htmlPage(),
  });
}

test("authorization decisions reject anonymous and non-curator callers", () => {
  expect(resolveCuratorAccess(null, "")).toEqual({ ok: false, reason: "Curator sign-in required." });
  expect(resolveCuratorAccess(undefined, "")).toEqual({ ok: false, reason: "Curator sign-in required." });
  expect(resolveCuratorAccess({ email: "mallory@evil.example" }, "curator@backbone.ng")).toEqual({
    ok: false,
    reason: "Curator access only.",
  });
  expect(resolveCuratorAccess({ email: "Curator@Backbone.ng" }, "curator@backbone.ng")).toEqual({
    ok: true,
    reviewer: "Curator@Backbone.ng",
  });
  expect(resolveCuratorAccess({ email: "anyone@example.org" }, "")).toEqual({
    ok: true,
    reviewer: "anyone@example.org",
  });
  expect(resolveCuratorAccess("test-env", "curator@backbone.ng")).toEqual({ ok: true, reviewer: "test-env" });
  expect(emailAllowed("Curator@Backbone.ng")).toBe(true);
  // No allowlist configured in this env: demo mode passes signed-in emails.
  // Anonymous and allowlist rejection live in resolveCuratorAccess above.
  expect(emailAllowed("mallory@evil.example")).toBe(true);
});

test("decisions record the reviewer and preserve the original extraction", async () => {
  const t = convexTest(schema, modules);
  const res = await capture(t, okFetch());
  if (res.captureStatus !== "captured") throw new Error("capture failed");
  await t.mutation(api.importDrafts.decideField, {
    draftId: res.draftId,
    fieldKey: "benefit",
    decision: "correct",
    correctedValue: "₦5 billion youth fund",
  });
  const draft = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  const original = draft?.benefit;
  expect(original?.status).toBe("proposed");
  expect(original?.value).toMatch(/₦5 billion fund/);
  const decision = draft?.decisions?.find((d) => d.fieldKey === "benefit");
  expect(decision?.decision).toBe("correct");
  expect(decision?.correctedValue).toBe("₦5 billion youth fund");
  expect(decision?.reviewer).toBe("test-env");
});

test("unknown fields and empty corrections are rejected", async () => {
  const t = convexTest(schema, modules);
  const res = await capture(t, okFetch());
  if (res.captureStatus !== "captured") throw new Error("capture failed");
  await expect(
    t.mutation(api.importDrafts.decideField, { draftId: res.draftId, fieldKey: "nope", decision: "accept" }),
  ).rejects.toThrow(/Unknown draft field/);
  await expect(
    t.mutation(api.importDrafts.decideField, { draftId: res.draftId, fieldKey: "benefit", decision: "correct", correctedValue: "  " }),
  ).rejects.toThrow(/corrected text/);
});

test("publish requires a decision on every field", async () => {
  const t = convexTest(schema, modules);
  const res = await capture(t, okFetch());
  if (res.captureStatus !== "captured") throw new Error("capture failed");
  await t.mutation(api.importDrafts.decideField, { draftId: res.draftId, fieldKey: "title", decision: "accept" });
  await expect(
    t.mutation(api.importDrafts.publishDraft, {
      draftId: res.draftId,
      providerName: "Bank of Industry",
      providerType: "Bank",
      type: "grant",
    }),
  ).rejects.toThrow(/Review incomplete/);
});

test("ambiguous critical claims prevent a verified state but still publish honestly", async () => {
  const t = convexTest(schema, modules);
  const res = await capture(t, okFetch());
  if (res.captureStatus !== "captured") throw new Error("capture failed");
  const draft = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  const keys = draftFieldKeys(draft?.criteria.length ?? 0);
  for (const fieldKey of keys) {
    await t.mutation(api.importDrafts.decideField, {
      draftId: res.draftId,
      fieldKey,
      decision: fieldKey === "deadline" ? "ambiguous" : "accept",
    });
  }
  const out = await t.mutation(api.importDrafts.publishDraft, {
    draftId: res.draftId,
    providerName: "Bank of Industry",
    providerType: "Bank",
    type: "grant",
  });
  expect(out.status).toBe("unverified");
  expect(out.gaps).toContain("deadline");
  const stored = await t.run(async (ctx) => ctx.db.get("opportunities", out.opportunityId));
  expect(stored?.status).toBe("unverified");
  expect(stored?.catalogVisibility).toBe("hidden");
  // Unqualified records stay out of the public catalog.
  const items = await t.query(api.opportunities.list, {});
  expect(items.find((o) => o._id === out.opportunityId)).toBeUndefined();
  const listed = await t.query(api.opportunities.getById, { id: out.opportunityId });
  expect(listed).toBeNull();
  const updated = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  expect(updated?.reviewStatus).toBe("published");
  expect(updated?.publishedBy).toBe("test-env");
  expect(updated?.publishedOpportunityId).toBe(out.opportunityId);
});

test("a fully accepted draft publishes verified with evidence end to end", async () => {
  const t = convexTest(schema, modules);
  const res = await capture(t, okFetch());
  if (res.captureStatus !== "captured") throw new Error("capture failed");
  const draft = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  const keys = draftFieldKeys(draft?.criteria.length ?? 0);
  for (const fieldKey of keys) {
    await t.mutation(api.importDrafts.decideField, { draftId: res.draftId, fieldKey, decision: "accept" });
  }
  const out = await t.mutation(api.importDrafts.publishDraft, {
    draftId: res.draftId,
    providerName: "Bank of Industry",
    providerType: "Bank",
    type: "grant",
  });
  expect(out.status).toBe("verified");
  expect(out.gaps).toEqual([]);
  const opp = await t.query(api.opportunities.getById, { id: out.opportunityId });
  expect(opp?.title).toBe("BOI Youth Fund");
  expect(opp?.eligibilityRules.length).toBeGreaterThan(0);
  const evidence = await t.query(api.opportunities.getEvidence, { id: out.opportunityId });
  expect(evidence?.summary.supported).toBeGreaterThan(2);
  expect(evidence?.claims.every((c) => c.sourceUrl === "https://youth.boi.ng/fund")).toBe(true);
  const items = await t.query(api.opportunities.list, {});
  expect(items.find((o) => o._id === out.opportunityId)?.title).toBe("BOI Youth Fund");
});

test("a rejected title blocks publication", async () => {
  const t = convexTest(schema, modules);
  const res = await capture(t, okFetch());
  if (res.captureStatus !== "captured") throw new Error("capture failed");
  const draft = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  const keys = draftFieldKeys(draft?.criteria.length ?? 0);
  for (const fieldKey of keys) {
    await t.mutation(api.importDrafts.decideField, {
      draftId: res.draftId,
      fieldKey,
      decision: fieldKey === "title" ? "reject" : "accept",
    });
  }
  await expect(
    t.mutation(api.importDrafts.publishDraft, {
      draftId: res.draftId,
      providerName: "Bank of Industry",
      providerType: "Bank",
      type: "grant",
    }),
  ).rejects.toThrow(/accepted title/);
});
