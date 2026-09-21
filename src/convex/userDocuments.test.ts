/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, seededGlowId } from "../test/convexFixtures";
import { documentState } from "./userDocuments";

const modules = import.meta.glob("./**/*.ts");
const PDF: ArrayBuffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer as ArrayBuffer;

async function asIdentity(
  t: ReturnType<typeof convexTest>,
  kind: "user" | "device" | undefined,
  id?: string,
) {
  await t.mutation(internal.identity._setTestIdentity, kind && id ? { kind, id } : {});
}

async function glowId(t: ReturnType<typeof convexTest>) {
  return seededGlowId(t);
}

test("document states separate presence from acceptance", () => {
  const now = 1000;
  expect(documentState(null, now)).toBe("missing");
  expect(documentState({ verification: "unverified", updatedAt: 1 }, now)).toBe("present-unverified");
  expect(documentState({ verification: "accepted", updatedAt: 1 }, now)).toBe("accepted");
  expect(documentState({ verification: "accepted", expiresAt: 999, updatedAt: 1 }, now)).toBe("expired");
  expect(documentState({ verification: "accepted", expiresAt: 1001, updatedAt: 1 }, now)).toBe("accepted");
});

test("valid upload stores privately with no public URL", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  const res = await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "x",
    docType: "cac-certificate",
    fileName: "cac.pdf",
    mimeType: "application/pdf",
    content: PDF,
  });
  expect(res.replaced).toBe(false);
  expect(res.state).toBe("present-unverified");
  const rows = await t.query(api.userDocuments.listDocuments, { ownerKey: "x" });
  expect(rows).toHaveLength(1);
  expect(rows[0].state).toBe("present-unverified");
  expect(rows[0]).not.toHaveProperty("content");
  const got = await t.query(api.userDocuments.getDocument, { ownerKey: "x", documentId: rows[0]._id });
  expect(got?.fileName).toBe("cac.pdf");
  expect(new Uint8Array(got?.content ?? new ArrayBuffer(0))).toEqual(new Uint8Array(PDF));
  await asIdentity(t, undefined);
});

test("invalid type, empty, and oversized uploads are rejected", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  await expect(
    t.mutation(api.userDocuments.uploadDocument, {
      ownerKey: "x",
      docType: "cac-certificate",
      fileName: "evil.exe",
      mimeType: "application/x-msdownload",
      content: PDF,
    }),
  ).rejects.toThrow(/Only PDF, JPEG, or PNG/);
  await expect(
    t.mutation(api.userDocuments.uploadDocument, {
      ownerKey: "x",
      docType: "cac-certificate",
      fileName: "empty.pdf",
      mimeType: "application/pdf",
      content: new Uint8Array([]).buffer as ArrayBuffer,
    }),
  ).rejects.toThrow(/empty/);
  await expect(
    t.mutation(api.userDocuments.uploadDocument, {
      ownerKey: "x",
      docType: "cac-certificate",
      fileName: "big.pdf",
      mimeType: "application/pdf",
      content: new Uint8Array(300 * 1024).buffer as ArrayBuffer,
    }),
  ).rejects.toThrow(/capped/);
  await asIdentity(t, undefined);
});

test("replacement resets verification; deletion removes", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "x",
    docType: "id-card",
    fileName: "id.jpg",
    mimeType: "image/jpeg",
    content: PDF,
  });
  const rows = await t.query(api.userDocuments.listDocuments, { ownerKey: "x" });
  await t.mutation(api.userDocuments.verifyDocument, { documentId: rows[0]._id, accepted: true });
  const again = await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "x",
    docType: "id-card",
    fileName: "id2.jpg",
    mimeType: "image/jpeg",
    content: PDF,
  });
  expect(again.replaced).toBe(true);
  expect(again.documentId).toBe(rows[0]._id);
  expect((await t.query(api.userDocuments.listDocuments, { ownerKey: "x" }))[0].state).toBe(
    "present-unverified",
  );
  expect(
    await t.mutation(api.userDocuments.deleteDocument, { ownerKey: "x", documentId: rows[0]._id }),
  ).toBe(true);
  expect(await t.query(api.userDocuments.listDocuments, { ownerKey: "x" })).toHaveLength(0);
  await asIdentity(t, undefined);
});

test("cross-user access is denied", async () => {
  const t = convexTest(schema, modules);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "x",
    docType: "cac-certificate",
    fileName: "cac.pdf",
    mimeType: "application/pdf",
    content: PDF,
  });
  const rows = await t.query(api.userDocuments.listDocuments, { ownerKey: "x" });
  await asIdentity(t, "user", "user:bob");
  expect(await t.query(api.userDocuments.listDocuments, { ownerKey: "whatever" })).toHaveLength(0);
  expect(await t.query(api.userDocuments.getDocument, { ownerKey: "whatever", documentId: rows[0]._id })).toBeNull();
  expect(
    await t.mutation(api.userDocuments.deleteDocument, { ownerKey: "whatever", documentId: rows[0]._id }),
  ).toBeNull();
  await asIdentity(t, "user", "user:alice");
  expect(await t.query(api.userDocuments.listDocuments, { ownerKey: "x" })).toHaveLength(1);
  await asIdentity(t, undefined);
});

async function readinessFixture(t: ReturnType<typeof convexTest>) {
  const id = await insertOpportunity(t, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "docs",
      displayValue: "docs",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      checkedAt: 1,
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "cac-docs",
      label: "CAC documents",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "Upload the CAC certificate.",
      hardness: "hard",
      family: "documents",
      role: "mandatory",
      documentType: "cac-certificate",
      evidenceClaimKey: "docs",
    });
  });
  return id;
}

test("readiness distinguishes missing, unverified, accepted, and expired files", async () => {
  const t = convexTest(schema, modules);
  const id = await readinessFixture(t);
  await asIdentity(t, "user", "user:alice");
  const missing = await t.query(api.opportunities.evaluateReadiness, { id, ownerKey: "user:alice" });
  expect(missing?.assessments.find((a) => a.criterionKey === "cac-docs")?.result).toBe("unknown");
  await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "user:alice",
    docType: "cac-certificate",
    fileName: "cac.pdf",
    mimeType: "application/pdf",
    content: PDF,
  });
  const unverified = await t.query(api.opportunities.evaluateReadiness, { id, ownerKey: "user:alice" });
  expect(unverified?.assessments.find((a) => a.criterionKey === "cac-docs")?.result).toBe("needs-evidence");
  expect(unverified?.overall).toBe("needs-information");
  const rows = await t.query(api.userDocuments.listDocuments, { ownerKey: "user:alice" });
  await t.mutation(api.userDocuments.verifyDocument, { documentId: rows[0]._id, accepted: true });
  const accepted = await t.query(api.opportunities.evaluateReadiness, { id, ownerKey: "user:alice" });
  expect(accepted?.assessments.find((a) => a.criterionKey === "cac-docs")?.result).toBe("met");
  expect(accepted?.overall).toBe("ready");
  await t.mutation(api.userDocuments.verifyDocument, {
    documentId: rows[0]._id,
    accepted: true,
    expiresAt: 500,
  });
  const expired = await t.query(api.opportunities.evaluateReadiness, { id, ownerKey: "user:alice" });
  expect(expired?.assessments.find((a) => a.criterionKey === "cac-docs")?.result).toBe("unmet");
  expect(expired?.overall).toBe("not-currently-eligible");
  const states = await t.query(api.userDocuments.documentReadiness, {
    ownerKey: "user:alice",
    opportunityId: id,
  });
  expect(states).toEqual([
    { criterionKey: "cac-docs", label: "CAC documents", state: "expired", documentId: rows[0]._id },
  ]);
  await asIdentity(t, undefined);
});

test("export and delete cover documents, catalog untouched", async () => {
  const t = convexTest(schema, modules);
  const id = await glowId(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "x",
    docType: "id-card",
    fileName: "id.jpg",
    mimeType: "image/jpeg",
    content: PDF,
  });
  expect(id).toBeTruthy();
  const out = await t.mutation(api.dataControls.deleteMyData, { confirmation: "DELETE" });
  expect(out.deleted.documents).toBe(1);
  expect(await t.query(api.userDocuments.listDocuments, { ownerKey: "x" })).toHaveLength(0);
  expect(await t.query(api.opportunities.list, {})).toHaveLength(6);
  await asIdentity(t, undefined);
});
