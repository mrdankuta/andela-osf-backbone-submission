/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import { hashText } from "../lib/source-monitor";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function verifiedFixture(t: ReturnType<typeof convexTest>, sourceUrl: string) {
  const id = await insertOpportunity(t, { sourceUrl });
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "geo",
      displayValue: "geo",
      status: "supported",
      sourceUrl,
      sourcePassage: "Operates in Nigeria.",
      checkedAt: AS_OF,
    });
  });
  return id;
}

function stubFetch(handler: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

const pageV1 = "<html><body><p>A fund for women-owned businesses across Nigeria with mentoring.</p></body></html>";

test("unchanged sources record the check with no flag", async () => {
  const t = convexTest(schema, modules);
  const id = await verifiedFixture(t, "https://example.org/fund");
  stubFetch(async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => pageV1 }));
  const first = await t.action(internal.sourceMonitor.checkPublishedSources, {});
  expect(first).toEqual({ checked: 1, unchanged: 0, changed: 1, meaningful: 0, unreachable: 0 });
  const second = await t.action(internal.sourceMonitor.checkPublishedSources, {});
  expect(second).toEqual({ checked: 1, unchanged: 1, changed: 0, meaningful: 0, unreachable: 0 });
  const freshness = await t.query(api.sourceMonitor.getFreshness, { id });
  expect(freshness?.state).toBe("ok");
  expect(freshness?.lastChecked).toBeGreaterThan(0);
  const flags = await t.query(api.curation.queue, {});
  expect(flags).toEqual([]);
});

test("meaningful changes mark claims stale and page a curator", async () => {
  const t = convexTest(schema, modules);
  const id = await verifiedFixture(t, "https://example.org/fund");
  stubFetch(async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => pageV1 }));
  await t.action(internal.sourceMonitor.checkPublishedSources, {});
  stubFetch(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    text: async () => "<html><body><p>Closed permanently. This programme has ended and all pages were removed.</p></body></html>",
  }));
  const res = await t.action(internal.sourceMonitor.checkPublishedSources, {});
  expect(res.meaningful).toBe(1);
  const freshness = await t.query(api.sourceMonitor.getFreshness, { id });
  expect(freshness?.state).toBe("under-review");
  const flags = await t.query(api.curation.queue, {});
  expect(flags.length).toBe(1);
  expect(flags[0].reason).toBe("Source changed");
  const opp = await t.run(async (ctx) => ctx.db.get("opportunities", id));
  expect(opp?.sourceStatus).toBe("stale");
});

test("inaccessible sources go unavailable with a recheck item", async () => {
  const t = convexTest(schema, modules);
  const id = await verifiedFixture(t, "https://example.org/fund");
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const res = await t.action(internal.sourceMonitor.checkPublishedSources, {});
  expect(res).toEqual({ checked: 1, unchanged: 0, changed: 0, meaningful: 0, unreachable: 1 });
  const freshness = await t.query(api.sourceMonitor.getFreshness, { id });
  expect(freshness?.state).toBe("unavailable");
  const flags = await t.query(api.curation.queue, {});
  expect(flags.length).toBe(1);
  expect(flags[0].reason).toBe("Source unreachable");
});

test("HTTP errors are recorded, not invented around", async () => {
  const t = convexTest(schema, modules);
  stubFetch(async () => ({ ok: false, status: 503, headers: { get: () => "text/html" }, text: async () => "" }));
  const id = await verifiedFixture(t, "https://example.org/fund");
  await t.action(internal.sourceMonitor.checkPublishedSources, {});
  const freshness = await t.query(api.sourceMonitor.getFreshness, { id });
  expect(freshness?.state).toBe("unavailable");
});

test("passed deadlines transition to expired and read closed", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: 1_000_000_000_000 });
  await t.mutation(internal.crons.expirePastDeadlines, {});
  const opp = await t.query(api.opportunities.getById, { id });
  expect(opp).toBeNull();
  const stored = await t.run(async (ctx) => ctx.db.get("opportunities", id));
  expect(stored?.status).toBe("expired");
  const freshness = await t.query(api.sourceMonitor.getFreshness, { id });
  expect(freshness?.state).toBe("closed");
});

test("content versions are content-derived", () => {
  expect(hashText(pageV1)).toBe(hashText(pageV1));
});
