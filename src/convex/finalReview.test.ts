/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const DAY = 86400000;
const PDF: ArrayBuffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer as ArrayBuffer;

async function reviewFixture(t: ReturnType<typeof convexTest>) {
  const id = await insertOpportunity(t, { deadline: AS_OF + 30 * DAY });
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "cac",
      displayValue: "cac",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      sourcePassage: "Must be CAC registered.",
      checkedAt: AS_OF,
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "cac-registered",
      label: "CAC registered",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "Must be CAC registered.",
      hardness: "hard",
      evidenceClaimKey: "cac",
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "cac-docs",
      label: "CAC documents",
      profileField: "cac",
      operator: "present",
      expectedValues: [],
      requirement: "Upload the CAC certificate.",
      hardness: "hard",
      family: "documents",
      role: "mandatory",
      documentType: "cac-certificate",
      evidenceClaimKey: "cac",
    });
  });
  return id;
}

test("ready reviews list everything and allow handoff", async () => {
  const t = convexTest(schema, modules);
  const id = await reviewFixture(t);
  const res = await t.query(api.finalReview.finalReview, { id, cac: "Registered", asOf: AS_OF });
  expect(res?.overall).toBe("needs-information");
  expect(res?.mandatory.map((m) => m.criterionKey)).toContain("cac-registered");
  expect(res?.confirmedFacts).toMatchObject([{ field: "cac", value: "Registered" }]);
  expect(res?.documents).toEqual([
    { criterionKey: "cac-docs", label: "CAC documents", state: "missing", documentId: null },
  ]);
  expect(res?.unresolved.some((u) => u.kind === "document")).toBe(true);
  expect(res?.deadline.urgent).toBe(false);
  expect(res?.destination.verified).toBe(true);
  expect(res?.authorityNote).toMatch(/decides/);
});

test("missing documents appear as unresolved issues", async () => {
  const t = convexTest(schema, modules);
  const id = await reviewFixture(t);
  const res = await t.query(api.finalReview.finalReview, {
    id,
    cac: "Registered",
    ownerKey: "dev-1",
    asOf: AS_OF,
  });
  const docIssue = res?.unresolved.find((u) => u.kind === "document");
  expect(docIssue?.detail).toMatch(/No file uploaded/);
});

test("stale sources are prominent", async () => {
  const t = convexTest(schema, modules);
  const id = await reviewFixture(t);
  await t.run(async (ctx) => ctx.db.patch("opportunities", id, { sourceStatus: "stale" }));
  const res = await t.query(api.finalReview.finalReview, { id, asOf: AS_OF });
  expect(res?.freshness.state).toBe("stale");
  expect(res?.unresolved.some((u) => u.kind === "evidence")).toBe(true);
});

test("ambiguous criteria surface for confirmation", async () => {
  const t = convexTest(schema, modules);
  const id = await reviewFixture(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "cac",
      displayValue: "cac",
      status: "contradicted",
      sourceUrl: "https://example.org/other",
      sourcePassage: "CAC registration is not required.",
      checkedAt: AS_OF,
    });
  });
  const res = await t.query(api.finalReview.finalReview, { id, cac: "Registered", asOf: AS_OF });
  expect(res?.unresolved.some((u) => u.label === "CAC registered")).toBe(true);
});

test("expired plans cannot continue", async () => {
  const t = convexTest(schema, modules);
  const id = await reviewFixture(t);
  await t.run(async (ctx) => ctx.db.patch("opportunities", id, { deadline: 1_000_000_000_000 }));
  await t.mutation(internal.crons.expirePastDeadlines, {});
  const stored = await t.run(async (ctx) => ctx.db.get("opportunities", id));
  expect(stored?.status).toBe("expired");
  const res = await t.query(api.finalReview.finalReview, { id, asOf: AS_OF });
  expect(res).toBeNull();
});

test("continuing records applying without claiming submission", async () => {
  const t = convexTest(schema, modules);
  const id = await reviewFixture(t);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-1" });
  // The handoff path is the existing plan machine: review, then apply.
  const review = await t.query(api.finalReview.finalReview, { id, cac: "Registered", asOf: AS_OF });
  expect(review?.canContinue).toBe(true);
  await t.mutation(api.track.setPlanState, { opportunityId: id, deviceId: "dev-1", state: "applying" });
  const rows = await t.query(api.track.list, { deviceId: "dev-1" });
  expect(rows[0].displayState).toBe("applying");
});

test("accepted documents clear their unresolved flag", async () => {
  const t = convexTest(schema, modules);
  const id = await reviewFixture(t);
  await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "dev-1",
    opportunityId: id,
    criterionKey: "cac-docs",
    docType: "cac-certificate",
    fileName: "cac.pdf",
    mimeType: "application/pdf",
    content: PDF,
  });
  const docs = await t.query(api.userDocuments.listDocuments, { ownerKey: "dev-1" });
  await t.mutation(api.userDocuments.verifyDocument, { documentId: docs[0]._id, accepted: true });
  const res = await t.query(api.finalReview.finalReview, {
    id,
    cac: "Registered",
    ownerKey: "dev-1",
    asOf: AS_OF,
  });
  expect(res?.documents).toEqual([
    { criterionKey: "cac-docs", label: "CAC documents", state: "accepted", documentId: docs[0]._id },
  ]);
  expect(res?.unresolved.some((u) => u.kind === "document")).toBe(false);
  expect(res?.overall).toBe("ready");
});
