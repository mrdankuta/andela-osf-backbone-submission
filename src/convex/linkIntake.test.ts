/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, seededGlow } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

async function glowId(t: ReturnType<typeof convexTest>) {
  return seededGlow(t);
}

test("a known forward resolves with trust and freshness first", async () => {
  const t = convexTest(schema, modules);
  const glow = await glowId(t);
  const res = await t.query(api.linkIntake.resolveLink, {
    url: "https://iprogrammes.boi.ng/?utm_source=whatsapp#top",
  });
  expect(res.outcome).toBe("known");
  if (res.outcome !== "known") return;
  expect(res.opportunityId).toBe(glow._id);
  expect(res.title).toMatch(/GLOW/);
  expect(res.lastVerified).toBeGreaterThan(0);
  expect(res.freshness).toBeTruthy();
});

test("a non-public record reads as in-review, never verified", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { sourceUrl: "https://example.org/hidden-fund" });
  await t.run(async (ctx) => ctx.db.patch("opportunities", id, { catalogVisibility: "hidden" }));
  const res = await t.query(api.linkIntake.resolveLink, { url: "https://example.org/hidden-fund" });
  expect(res.outcome).toBe("in-review");
  if (res.outcome !== "in-review") return;
  expect(res.detail).toMatch(/not verified yet/);
});

test("an expired record reads as closed", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { sourceUrl: "https://example.org/old-fund" });
  await t.run(async (ctx) => ctx.db.patch("opportunities", id, { status: "expired" }));
  const res = await t.query(api.linkIntake.resolveLink, { url: "https://example.org/old-fund" });
  expect(res.outcome).toBe("in-review");
  if (res.outcome !== "in-review") return;
  expect(res.detail).toMatch(/closed/);
});

test("unknown links stay unlabeled and can be suggested", async () => {
  const t = convexTest(schema, modules);
  const unknown = await t.query(api.linkIntake.resolveLink, { url: "https://new-fund.example.org/a" });
  expect(unknown.outcome).toBe("unknown");
  const first = await t.mutation(api.linkIntake.suggestLink, {
    url: "https://new-fund.example.org/a?utm_source=wa",
    deviceId: "d1",
  });
  expect(first.duplicate).toBe(false);
  if (!("suggestionId" in first) || !first.suggestionId) throw new Error("expected suggestion");
  const second = await t.mutation(api.linkIntake.suggestLink, { url: "https://new-fund.example.org/a" });
  expect(second).toMatchObject({ duplicate: true });
  expect((second as { suggestionId: unknown }).suggestionId).toBe(first.suggestionId);
  expect(await t.query(api.linkIntake.resolveLink, { url: "not a link" })).toMatchObject({
    outcome: "invalid",
  });
});

test("suggesting a known link returns known instead of a candidate", async () => {
  const t = convexTest(schema, modules);
  await glowId(t);
  const res = await t.mutation(api.linkIntake.suggestLink, { url: "https://iprogrammes.boi.ng/" });
  expect(res).toMatchObject({ outcome: "known" });
});

test("curators triage suggestions into imports", async () => {
  const t = convexTest(schema, modules);
  const made = await t.mutation(api.linkIntake.suggestLink, { url: "https://candidate.example.org/x" });
  if (!("suggestionId" in made) || !made.suggestionId) throw new Error("expected suggestion");
  const pending = await t.query(api.linkIntake.listSuggestions, {});
  expect(pending.map((s) => s.normalizedUrl)).toContain("candidate.example.org/x");
  await t.mutation(api.linkIntake.resolveSuggestion, {
    suggestionId: made.suggestionId,
    outcome: "declined",
  });
  expect(await t.query(api.linkIntake.listSuggestions, {})).toHaveLength(0);
});
