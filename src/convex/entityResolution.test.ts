/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity, seededGlowId } from "../test/convexFixtures";
import {
  blockCandidates,
  judgePair,
  normalizeEntityName,
} from "./entityResolutionPolicy";

const modules = import.meta.glob("./**/*.ts");

test("aliases normalize to the same provider", () => {
  expect(normalizeEntityName("BOI")).toBe(normalizeEntityName("Bank of Industry"));
  expect(normalizeEntityName("Bank of Industry Ltd.")).toBe(normalizeEntityName("Bank of Industry"));
});

test("identical names from one source are the same", async () => {
  const j = await judgePair(
    { name: "GLOW Portal", source: "https://glow.boi.ng/" },
    { name: "Glow Portal", source: "https://glow.boi.ng/apply" },
  );
  expect(j.relation).toBe("same");
});

test("same name from conflicting sources goes to review", async () => {
  const j = await judgePair(
    { name: "Youth Fund", source: "https://a-example.org/" },
    { name: "Youth Fund", source: "https://b-example.org/" },
  );
  expect(j.relation).toBe("review");
});

test("recurring cohorts link instead of merging", async () => {
  const j = await judgePair({ name: "GLOW 2025" }, { name: "GLOW 2026" });
  expect(j.relation).toBe("related");
  expect(j.cohortLabel).toMatch(/2025/);
  expect(j.cohortLabel).toMatch(/2026/);
});

test("unrelated records are different", async () => {
  const j = await judgePair({ name: "Sugar Projects Fund" }, { name: "Tertiary Staff Loans" });
  expect(j.relation).toBe("different");
});

test("a judge refines uncertain pairs, uncertainty stays in review", async () => {
  const same = await judgePair(
    { name: "GLOW Support" },
    { name: "GLOW Assistance" },
    async () => ({ entity: { choice: "same", confidence: 0.9 } }),
  );
  expect(same.relation).toBe("same");
  const unsure = await judgePair(
    { name: "GLOW Support" },
    { name: "GLOW Assistance" },
    async () => ({ entity: { choice: "uncertain", confidence: 0.9 } }),
  );
  expect(unsure.relation).toBe("review");
  const weak = await judgePair(
    { name: "GLOW Support" },
    { name: "GLOW Assistance" },
    async () => ({ entity: { choice: "same", confidence: 0.4 } }),
  );
  expect(weak.relation).toBe("review");
});

test("candidates block by host or shared tokens, not the full catalog", () => {
  const existing = [
    { name: "Sugar Projects Fund", source: "https://sugar.example.org/" },
    { name: "Tertiary Staff Loans", source: "https://tissf.example.org/" },
    { name: "GLOW Extra", source: "https://other.example.org/" },
  ];
  const hits = blockCandidates(
    { name: "GLOW Portal", source: "https://glow.boi.ng/" },
    existing,
    (e) => e.name,
    (e) => e.source,
  );
  expect(hits.map((h) => h.name)).toEqual(["GLOW Extra"]);
  const hostHit = blockCandidates(
    { name: "Something Else", source: "https://sugar.example.org/x" },
    existing,
    (e) => e.name,
    (e) => e.source,
  );
  expect(hostHit.map((h) => h.name)).toEqual(["Sugar Projects Fund"]);
});

async function draftId(t: ReturnType<typeof convexTest>, title: string, sourceUrl: string) {
  return await t.run(async (ctx) => {
    const blank = { status: "unresolved" as const, value: null, passage: null, confidence: 0 };
    return await ctx.db.insert("importDrafts", {
      sourceUrl,
      capturedAt: 1,
      captureStatus: "captured",
      title: { status: "proposed" as const, value: title, passage: title, confidence: 0.5 },
      benefit: blank,
      deadline: blank,
      deadlineAt: null,
      contacts: blank,
      criteria: [],
      programStatus: blank,
      applyDestination: blank,
      reviewStatus: "needs-review",
    });
  });
}

test("linked duplicates leave the catalog; revert restores them", async () => {
  const t = convexTest(schema, modules);
  const glow = await seededGlowId(t);
  const dupe = await insertOpportunity(t, { title: "GLOW — Guaranteed Loans for Women" });
  expect((await t.query(api.opportunities.list, {})).length).toBe(7);
  const linkId = await t.mutation(api.entityLinks.linkEntities, {
    kind: "program",
    fromId: dupe,
    toId: glow,
    relation: "same",
    note: "Same programme, re-imported.",
  });
  expect((await t.query(api.opportunities.list, {})).length).toBe(6);
  const links = await t.query(api.entityLinks.listLinks, {});
  expect(links[0].fromName).toMatch(/GLOW/);
  expect(links[0].toName).toMatch(/GLOW/);
  expect(links[0].decidedBy).toBe("test-env");
  await t.mutation(api.entityLinks.revertLink, { linkId });
  expect((await t.query(api.opportunities.list, {})).length).toBe(7);
});

test("cohort links keep both programmes visible", async () => {
  const t = convexTest(schema, modules);
  const glowId = await seededGlowId(t);
  const next = await insertOpportunity(t, { title: "GLOW 2026 cohort" });
  await t.mutation(api.entityLinks.linkEntities, {
    kind: "program",
    fromId: next,
    toId: glowId,
    relation: "cohort",
    cohortLabel: "2026",
  });
  expect((await t.query(api.opportunities.list, {})).length).toBe(7);
});

test("draft duplicates are suggested with judgments", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const id = await draftId(t, "GLOW — Guaranteed Loans for Women", "https://glow.boi.ng/portal");
  const suggestions = await t.query(api.entityLinks.suggestProgramLinks, { draftId: id });
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions[0].relation).toBe("same");
  expect(suggestions[0].candidateName).toMatch(/GLOW/);
});

test("provider aliases resolve to the seeded provider", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const suggestions = await t.query(api.entityLinks.suggestProviderLinks, {
    name: "BOI",
    officialLink: "https://www.boi.ng/prog",
  });
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions[0].candidateName).toBe("Bank of Industry");
  expect(suggestions[0].relation).toBe("same");
});

test("link validation rejects nonsense", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  await expect(
    t.mutation(api.entityLinks.linkEntities, { kind: "program", fromId: id, toId: id, relation: "same" }),
  ).rejects.toThrow(/itself/);
  await expect(
    t.mutation(api.entityLinks.linkEntities, {
      kind: "program",
      fromId: id,
      toId: await t.run(async (ctx) => {
        const temp = await ctx.db.insert("opportunities", {
          title: "Temp",
          providerName: "Temp",
          providerType: "Bank",
          type: "grant",
          amountOrBenefit: "x",
          locationEligibility: "All Nigeria",
          sectorTags: [],
          summaryPlain: "x",
          eligibilityRules: [],
          steps: [],
          documents: [],
          contacts: { officialLink: "https://example.org" },
          sourceUrl: "https://example.org/temp",
          lastVerified: 1,
          status: "verified",
          catalogVisibility: "public",
        });
        await ctx.db.delete("opportunities", temp);
        return temp;
      }),
      relation: "same",
    }),
  ).rejects.toThrow(/does not exist/);
  const next = await insertOpportunity(t, { title: "GLOW 2027 cohort" });
  await expect(
    t.mutation(api.entityLinks.linkEntities, { kind: "program", fromId: next, toId: id, relation: "cohort" }),
  ).rejects.toThrow(/cohort label/);
});
