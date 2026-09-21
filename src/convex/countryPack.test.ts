/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import { COUNTRY_PACKS, GHANA_PACK, NIGERIA_PACK, resolveExplanationLanguage } from "./countryPacks";
import { normalizeEntityName } from "./entityResolutionPolicy";
import { inferFamilyFromField } from "./readinessPolicy";
import { extractDraftFields } from "../lib/import-extractor";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;

// Real snapshot excerpt, captured live from https://gea.gov.gh/ on
// 2026-09-19 via the import pipeline (dev draft k976kgw4bc018g06xjqzxf7abh8ep8vr).
const GEA_SNAPSHOT = [
  "Ghana Enterprises Agency - Transforming MSMEs, Empowering People.",
  "Business In A Box Project GEA and the Mastercard Foundation designed the Business in A Box (BizBox) Project to provide young people especially women, with opportunities.",
  "YouStart GJSP The Agency will provide entrepreneurship training to 50,000 youth and early adults who have the potential to start a business.",
  "FUNDING GEA can provide funds for your small business at very competitive rates to grow your business.",
  "FIND BRC/BAC GEA has over 209 Business Advisory Centers (BACs) to provide our range of services to MSMEs.",
].join(" ");

afterEach(() => {
  vi.unstubAllGlobals();
});

test("pack aliases extend normalization without forking", () => {
  expect(normalizeEntityName("GEA", GHANA_PACK.institutionAliases)).toBe(
    normalizeEntityName("Ghana Enterprises Agency"),
  );
  expect(normalizeEntityName("NBSSI", GHANA_PACK.institutionAliases)).toBe(
    normalizeEntityName("Ghana Enterprises Agency"),
  );
  // Nigerian aliases still resolve through the shared table.
  expect(normalizeEntityName("BOI")).toBe(normalizeEntityName("Bank of Industry"));
});

test("pack field mappings agree with the shared engine", () => {
  for (const pack of Object.values(COUNTRY_PACKS)) {
    expect(pack.fieldMapping.geography).toBe("state");
    expect(inferFamilyFromField("state")).toBe("geography");
  }
  expect(GHANA_PACK.regions).toContain("Ashanti");
  expect(NIGERIA_PACK.regions).toContain("Lagos");
  expect(GHANA_PACK.regions).not.toContain("Lagos");
});

test("language precedence is explicit with fallback", () => {
  expect(resolveExplanationLanguage(GHANA_PACK, "en")).toEqual({ lang: "en", fallback: false });
  expect(resolveExplanationLanguage(GHANA_PACK, "pidgin")).toEqual({ lang: "pidgin", fallback: false });
  const tw = resolveExplanationLanguage(GHANA_PACK, "tw");
  expect(tw.fallback).toBe(true);
  if (tw.fallback) expect(tw.governsNote).toMatch(/English.*governs/);
  expect(resolveExplanationLanguage(GHANA_PACK, "ga").fallback).toBe(true);
});

test("Ghana journey: ingestion extracts real youth content", () => {
  const draft = extractDraftFields(GEA_SNAPSHOT, "https://gea.gov.gh/");
  expect(draft.benefit.status).toBe("proposed");
  expect(draft.benefit.value).toMatch(/young people especially women/);
  expect(draft.criteria.length).toBeGreaterThan(0);
});

test("Ghana journey: review, publish, verdict, and next action", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => `<html><head><title>BizBox Youth Support</title></head><body><p>${GEA_SNAPSHOT}</p></body></html>`,
    })),
  );
  const imported = await t.action(api.importDrafts.requestImport, { sourceUrl: "https://gea.gov.gh/bizbox" });
  expect(imported.captureStatus).toBe("captured");
  if (imported.captureStatus !== "captured") return;
  const draft = await t.query(api.importDrafts.getDraft, { draftId: imported.draftId });
  const keys = [
    "title",
    "benefit",
    "deadline",
    "contacts",
    "programStatus",
    "applyDestination",
    ...(draft?.criteria ?? []).map((_, i) => `criterion:${i}`),
  ];
  for (const fieldKey of keys) {
    await t.mutation(api.importDrafts.decideField, { draftId: imported.draftId, fieldKey, decision: "accept" });
  }
  const published = await t.mutation(api.importDrafts.publishDraft, {
    draftId: imported.draftId,
    providerName: "Ghana Enterprises Agency",
    providerType: "Agency",
    type: "grant",
  });
  // The snapshot publishes no deadline: honest unverified, still end to end.
  expect(published.status).toBe("unverified");
  const oppId = published.opportunityId;
  // Curator verification completes the journey (unknown deadlines stay unknown).
  await t.mutation(api.curation.publish, { opportunityId: oppId });
  await t.run(async (ctx) => {
    const evidence = (await ctx.db.get("opportunities", oppId)) ? true : false;
    expect(evidence).toBe(true);
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: oppId,
      claimType: "eligibility",
      claimKey: "ghana-region",
      displayValue: "Operates in Ghana",
      status: "supported",
      sourceUrl: "https://gea.gov.gh/",
      sourcePassage: "GEA has over 209 Business Advisory Centers (BACs) to provide our range of services to MSMEs.",
      checkedAt: AS_OF,
    });
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: oppId,
      claimType: "eligibility",
      claimKey: "ghana-youth",
      displayValue: "Youth founder",
      status: "supported",
      sourceUrl: "https://gea.gov.gh/",
      sourcePassage: "provide young people especially women, with opportunities",
      checkedAt: AS_OF,
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: oppId,
      criterionKey: "ghana-region",
      label: "Operates in Ghana",
      profileField: "state",
      operator: "one-of",
      expectedValues: [...GHANA_PACK.regions],
      requirement: "Operate in Ghana.",
      hardness: "hard",
      family: "geography",
      role: "mandatory",
      evidenceClaimKey: "ghana-region",
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: oppId,
      criterionKey: "ghana-youth",
      label: "Youth founder",
      profileField: "age",
      operator: "one-of",
      expectedValues: ["18–24", "25–35"],
      requirement: "Founder is young.",
      hardness: "remediable",
      family: "age",
      role: "preferred",
      evidenceClaimKey: "ghana-youth",
    });
    for (const guide of GHANA_PACK.guides) {
      await ctx.db.insert("readinessGuides", { opportunityId: oppId, ...guide });
    }
  });
  const verdict = await t.query(api.opportunities.evaluateReadiness, {
    id: oppId,
    state: "Ashanti",
    age: "25–35",
  });
  expect(verdict?.overall).toBe("ready");
  const plan = await t.query(api.opportunities.getReadinessPlan, {
    id: oppId,
    state: "Kano",
    age: "25–35",
    asOf: AS_OF,
  });
  expect(plan?.planStatus).toBe("blocked");
  expect(plan?.action).toBeNull();
  const actionable = await t.query(api.opportunities.getReadinessPlan, {
    id: oppId,
    state: "Ashanti",
    asOf: AS_OF,
  });
  // Youth unanswered (preferred, remediable): actionable with the pack guide.
  expect(actionable?.planStatus).toBe("actionable");
  expect(actionable?.action?.title).toBe("Confirm youth eligibility");
});

test("packs do not leak rules or providers across countries", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const glow = items.find((o) => o.title.includes("GLOW"))!;
  // Lagos facts mean nothing in Ashanti terms and vice versa.
  const ghanaStyle = await t.query(api.opportunities.evaluateReadiness, { id: glow._id, state: "Ashanti" });
  expect(ghanaStyle?.overall).not.toBe("ready");
  // Providers stay distinct.
  const providers = await t.query(api.providers.listProviders, {});
  expect(providers.map((p) => p.name)).toContain("Bank of Industry");
  expect(providers.map((p) => p.name)).not.toContain("Ghana Enterprises Agency");
  const suggestions = await t.query(api.entityLinks.suggestProviderLinks, { name: "Ghana Enterprises Agency" });
  expect(suggestions).toEqual([]);
});
