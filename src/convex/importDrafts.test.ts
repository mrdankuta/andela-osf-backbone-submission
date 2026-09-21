/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function stubFetch(html: string, status = 200, contentType = "text/html") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => contentType },
      text: async () => html,
    })),
  );
}

test("a curator import captures an evidence-linked draft", async () => {
  const t = convexTest(schema, modules);
  stubFetch(htmlPage());
  const res = await t.action(api.importDrafts.requestImport, { sourceUrl: "https://youth.boi.ng/fund" });
  expect(res.captureStatus).toBe("captured");
  if (res.captureStatus !== "captured") return;
  expect(res.proposed).toBeGreaterThan(2);
  const draft = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  expect(draft?.sourceUrl).toBe("https://youth.boi.ng/fund");
  expect(draft?.reviewStatus).toBe("needs-review");
  expect(draft?.title.value).toBe("BOI Youth Fund");
  expect(draft?.benefit.status).toBe("proposed");
  expect(draft?.deadline.value).toBe("2027-06-20");
  expect(draft?.deadlineAt).toBe(Date.parse("2027-06-20T00:00:00Z"));
  expect(draft?.contacts.value).toBe("https://youth.boi.ng/apply");
  expect(draft?.criteria.length).toBeGreaterThanOrEqual(1);
  expect(draft?.criteria[0].field.value).toBeTruthy();
  // No model key in tests: clauses classify to the explicit fallback.
  expect(draft?.criteria[0].family).toBe("other");
  expect(draft?.criteria[0].role).toBe("unclear");
  expect(draft?.snapshotText).toMatch(/₦5 billion/);
});

test("a retrieval failure stores a failed draft with a clear error", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("fetch failed");
    }),
  );
  const res = await t.action(api.importDrafts.requestImport, { sourceUrl: "https://gone.example.org/x" });
  expect(res.captureStatus).toBe("failed");
  if (res.captureStatus !== "failed") return;
  expect(res.error).toMatch(/Could not reach/);
  const draft = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  expect(draft?.captureStatus).toBe("failed");
  expect(draft?.captureError).toMatch(/Could not reach/);
});

test("an HTTP error becomes a failed draft, not a silent miss", async () => {
  const t = convexTest(schema, modules);
  stubFetch("not found", 404);
  const res = await t.action(api.importDrafts.requestImport, { sourceUrl: "https://example.org/missing" });
  expect(res.captureStatus).toBe("failed");
  if (res.captureStatus !== "failed") return;
  expect(res.error).toMatch(/HTTP 404/);
});

test("invalid URLs are rejected before any draft exists", async () => {
  const t = convexTest(schema, modules);
  await expect(t.action(api.importDrafts.requestImport, { sourceUrl: "not a url" })).rejects.toThrow(
    /not valid/,
  );
  const drafts = await t.query(api.importDrafts.listDrafts, {});
  expect(drafts).toEqual([]);
});

test("unsupported values stay unresolved, never invented", async () => {
  const t = convexTest(schema, modules);
  stubFetch("<html><head><title>Vague programme</title></head><body><p>A nice programme. Details soon.</p></body></html>");
  const res = await t.action(api.importDrafts.requestImport, { sourceUrl: "https://example.org/vague" });
  expect(res.captureStatus).toBe("captured");
  if (res.captureStatus !== "captured") return;
  const draft = await t.query(api.importDrafts.getDraft, { draftId: res.draftId });
  expect(draft?.deadline.status).toBe("unresolved");
  expect(draft?.deadline.value).toBeNull();
  expect(draft?.benefit.status).toBe("unresolved");
});

test("imported drafts never leak into the public catalog", async () => {
  const t = convexTest(schema, modules);
  await insertOpportunity(t, {});
  stubFetch(htmlPage());
  await t.action(api.importDrafts.requestImport, { sourceUrl: "https://youth.boi.ng/fund" });
  const items = await t.query(api.opportunities.list, {});
  expect(items.every((o) => !o.title.includes("Youth Fund"))).toBe(true);
  const drafts = await t.query(api.importDrafts.listDrafts, {});
  expect(drafts.length).toBe(1);
  expect(drafts[0].sourceUrl).toBe("https://youth.boi.ng/fund");
});

test("pre-hierarchy draft rows read through the honest fallback", async () => {
  const t = convexTest(schema, modules);
  const blank = { status: "unresolved", value: null, passage: null, confidence: 0 };
  const legacyId = await t.run(async (ctx) =>
    ctx.db.insert("importDrafts", {
      sourceUrl: "https://old.example.org/fund",
      capturedAt: 1,
      captureStatus: "captured",
      title: { status: "proposed", value: "Old Fund", passage: "Old Fund", confidence: 0.5 },
      benefit: blank,
      deadline: blank,
      deadlineAt: null,
      contacts: blank,
      criteria: [
        { status: "proposed", value: "Must be registered.", passage: "Must be registered.", confidence: 0.55 },
      ],
      programStatus: blank,
      applyDestination: blank,
      reviewStatus: "needs-review",
    } as never),
  );
  const draft = await t.query(api.importDrafts.getDraft, { draftId: legacyId });
  expect(draft?.criteria).toEqual([
    {
      field: { status: "proposed", value: "Must be registered.", passage: "Must be registered.", confidence: 0.55 },
      family: "other",
      role: "unclear",
    },
  ]);
  const drafts = await t.query(api.importDrafts.listDrafts, {});
  expect(drafts.find((d) => d.sourceUrl === "https://old.example.org/fund")).toBeTruthy();
});
