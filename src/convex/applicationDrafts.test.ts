/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");
const PDF: ArrayBuffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer as ArrayBuffer;

async function asIdentity(
  t: ReturnType<typeof convexTest>,
  kind: "user" | "device" | undefined,
  id?: string,
) {
  await t.mutation(internal.identity._setTestIdentity, kind && id ? { kind, id } : {});
}

async function oppWithCriteria(t: ReturnType<typeof convexTest>) {
  const id = await insertOpportunity(t, { title: "Grantor Fund", type: "grant" });
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "geo",
      displayValue: "geo",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      sourcePassage: "Open to Lagos businesses.",
      checkedAt: 1,
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "geo",
      label: "Operates in Lagos",
      profileField: "state",
      operator: "one-of",
      expectedValues: ["Lagos"],
      requirement: "Operate in Lagos.",
      hardness: "hard",
      evidenceClaimKey: "geo",
    });
  });
  return id;
}

test("complete inputs draft with traces and no gaps", async () => {
  const t = convexTest(schema, modules);
  const id = await oppWithCriteria(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, {
    ownerKey: "x",
    state: "Lagos",
    sector: "Tech",
    womenLed: true,
    source: "onboarding",
  });
  const draft = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "business-summary",
  });
  expect(draft.status).toBe("draft");
  expect(draft.gaps).toEqual([]);
  expect(draft.generatedText).toContain("Lagos");
  expect(draft.generatedText).toContain("Tech");
  expect(draft.generatedText).not.toMatch(/NEEDS/);
  expect(draft.traces.length).toBeGreaterThan(0);
  expect(draft.traces.every((tr) => tr.source.length > 0)).toBe(true);
  const elig = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "eligibility-statement",
  });
  expect(elig.generatedText).toMatch(/We meet/);
  expect(elig.gaps).toEqual([]);
  await asIdentity(t, undefined);
});

test("missing facts render as explicit gaps, never invented detail", async () => {
  const t = convexTest(schema, modules);
  const id = await oppWithCriteria(t);
  await asIdentity(t, "user", "user:alice");
  const draft = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "business-summary",
  });
  expect(draft.gaps.length).toBeGreaterThan(0);
  expect(draft.generatedText).toMatch(/\[NEEDS: business sector\]/);
  expect(draft.generatedText).toMatch(/\[NEEDS: operating state\]/);
  expect(draft.generatedText).not.toMatch(/Tech|Kano|fashion/i);
  await asIdentity(t, undefined);
});

test("conflicting facts surface both values with the override winning", async () => {
  const t = convexTest(schema, modules);
  const id = await oppWithCriteria(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Lagos", source: "onboarding" });
  await t.mutation(api.answerLedger.setAnswerOverride, {
    ownerKey: "x",
    opportunityId: id,
    profileField: "state",
    value: "Kano",
    valueType: "string",
  });
  const draft = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "business-summary",
  });
  expect(draft.generatedText).toContain("Kano");
  expect(draft.generatedText).not.toContain("Lagos");
  expect(draft.traces.map((tr) => tr.source).join(" ")).toMatch(/saved answer differs/);
  await asIdentity(t, undefined);
});

test("unmet criteria are gaps, and documents cover their question", async () => {
  const t = convexTest(schema, modules);
  const id = await oppWithCriteria(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Kano", source: "onboarding" });
  const elig = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "eligibility-statement",
  });
  expect(elig.gaps).toContain("criterion unmet: Operates in Lagos");
  expect(elig.generatedText).not.toMatch(/We meet “Operates in Lagos”/);
  const cover = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "document-cover",
  });
  expect(cover.gaps).toContain("no accepted document on file");
  await t.mutation(api.userDocuments.uploadDocument, {
    ownerKey: "x",
    docType: "id-card",
    fileName: "id.jpg",
    mimeType: "image/jpeg",
    content: PDF,
  });
  const docs = await t.query(api.userDocuments.listDocuments, { ownerKey: "x" });
  await t.mutation(api.userDocuments.verifyDocument, { documentId: docs[0]._id, accepted: true });
  const cover2 = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "document-cover",
  });
  expect(cover2.gaps).toEqual([]);
  expect(cover2.generatedText).toContain("id.jpg");
  await asIdentity(t, undefined);
});

test("edit, reject, and approve never touch confirmed facts", async () => {
  const t = convexTest(schema, modules);
  const id = await oppWithCriteria(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Lagos", source: "onboarding" });
  const draft = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "business-summary",
  });
  await t.mutation(api.applicationDrafts.editDraft, {
    ownerKey: "x",
    draftId: draft._id,
    editedText: "Edited by hand.",
  });
  const listed = await t.query(api.applicationDrafts.listDrafts, { ownerKey: "x", opportunityId: id });
  expect(listed[0].editedText).toBe("Edited by hand.");
  expect(listed[0].generatedText).toContain("Lagos");
  const approved = await t.mutation(api.applicationDrafts.reviewDraft, {
    ownerKey: "x",
    draftId: draft._id,
    approved: true,
  });
  expect(approved.status).toBe("approved");
  expect((await t.query(api.profiles.get, { ownerKey: "x" }))?.state).toBe("Lagos");
  expect(
    (await t.query(api.answerLedger.answerProvenance, { ownerKey: "x" })).filter((p) => p.field === "state"),
  ).toHaveLength(1);
  await asIdentity(t, undefined);
});

test("drafts are isolated across users", async () => {
  const t = convexTest(schema, modules);
  const id = await oppWithCriteria(t);
  await asIdentity(t, "user", "user:alice");
  await t.mutation(api.profiles.save, { ownerKey: "x", state: "Lagos", source: "onboarding" });
  await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "x",
    opportunityId: id,
    questionKey: "business-summary",
  });
  await asIdentity(t, "user", "user:bob");
  expect(await t.query(api.applicationDrafts.listDrafts, { ownerKey: "y" })).toEqual([]);
  const bobDraft = await t.mutation(api.applicationDrafts.generateDraft, {
    ownerKey: "y",
    opportunityId: id,
    questionKey: "business-summary",
  });
  expect(bobDraft.gaps.length).toBeGreaterThan(0);
  await asIdentity(t, undefined);
});
