/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Id } from "./_generated/dataModel";
import {
  applyFitToOrder,
  compareRanked,
  rankFactors,
  tierForRank,
  type RankedRow,
} from "./rankingPolicy";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;
const DAY = 86400000;

function row(overrides: Partial<RankedRow>): RankedRow {
  return {
    id: "a",
    factors: {
      excluded: [],
      readinessDistance: 0,
      unknownCount: 0,
      daysAvailable: 10,
      overall: "ready",
    },
    tier: "eligible",
    reasons: [],
    fit: "unknown",
    ...overrides,
  };
}

test("hard gates sort below viable rows and never promote", () => {
  const viable = row({ id: "viable" });
  const blocked = row({
    id: "blocked",
    factors: { excluded: ["Not eligible: CAC."], readinessDistance: 1, unknownCount: 0, daysAvailable: 1, overall: "not-currently-eligible" },
    tier: "check",
  });
  expect([blocked, viable].sort(compareRanked).map((r) => r.id)).toEqual(["viable", "blocked"]);
});

test("deterministic keys order distance, unknowns, deadline, then id", () => {
  const near = row({ id: "b", factors: { excluded: [], readinessDistance: 0, unknownCount: 1, daysAvailable: 30, overall: "needs-information" } });
  const far = row({ id: "a", factors: { excluded: [], readinessDistance: 2, unknownCount: 0, daysAvailable: 5, overall: "can-become-ready" } });
  const tie1 = row({ id: "id-1" });
  const tie2 = row({ id: "id-2" });
  const sorted = [far, tie2, near, tie1].sort(compareRanked).map((r) => r.id);
  expect(sorted).toEqual(["id-1", "id-2", "b", "a"]);
});

test("ambiguous fit keeps the deterministic position", () => {
  const a = row({ id: "a" });
  const b = row({ id: "b" });
  const reranked = applyFitToOrder([a, b], {
    a: { fit: "low", confidence: 0.4 },
    b: { fit: "high", confidence: 0.5 },
  });
  expect(reranked.map((r) => r.id)).toEqual(["a", "b"]);
  expect(reranked.every((r) => r.fit === "unknown")).toBe(true);
});

test("confident fit re-ranks viable rows only", () => {
  const a = row({ id: "a" });
  const b = row({ id: "b" });
  const blocked = row({
    id: "c",
    factors: { excluded: ["Closed."], readinessDistance: 0, unknownCount: 0, daysAvailable: 1, overall: "not-currently-eligible" },
    tier: "check",
  });
  const reranked = applyFitToOrder([a, b, blocked], {
    b: { fit: "high", confidence: 0.9 },
    a: { fit: "low", confidence: 0.95 },
    c: { fit: "high", confidence: 0.99 },
  });
  expect(reranked.map((r) => r.id)).toEqual(["b", "a", "c"]);
  expect(reranked[0].fit).toBe("high");
  expect(reranked[2].fit).toBe("unknown");
});

test("expired and hard-blocked factors exclude with reasons", () => {
  const factors = rankFactors(
    {
      id: "x",
      deadline: AS_OF - DAY,
      type: "grant",
      overall: "not-currently-eligible",
      assessments: [{ key: "k", label: "CAC", requirement: "r", hardness: "hard", result: "unmet" }],
    },
    { asOf: AS_OF },
  );
  expect(factors.excluded).toContain("Applications closed — the deadline has passed.");
  expect(factors.excluded).toContain("Not eligible: CAC.");
  expect(factors.daysAvailable).toBe(0);
});

test("tiers explain without percentages", () => {
  const base = { id: "x", type: "grant" as const, overall: "ready" as const, assessments: [] };
  const eligible = tierForRank(
    { excluded: [], readinessDistance: 0, unknownCount: 0, daysAvailable: 9, overall: "ready" },
    base,
    { asOf: AS_OF, needTypes: ["grant"] },
  );
  expect(eligible.tier).toBe("eligible");
  expect(eligible.reasons.join(" ")).not.toMatch(/%/);
  expect(eligible.reasons).toContain("Matches your grant need");
  const blocked = tierForRank(
    { excluded: ["Not eligible: CAC."], readinessDistance: 1, unknownCount: 0, daysAvailable: 9, overall: "not-currently-eligible" },
    base,
    { asOf: AS_OF },
  );
  expect(blocked).toEqual({ tier: "check", reasons: ["Not eligible: CAC."] });
});

async function grantFixture(t: ReturnType<typeof convexTest>, title: string, extra: Record<string, unknown> = {}) {
  const id = await insertOpportunity(t, { title, type: "grant", deadline: AS_OF + 30 * DAY, ...extra });
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "geo",
      displayValue: "geo",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      checkedAt: AS_OF,
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "geo",
      label: "Operates here",
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

test("match ranks viable first with decisive factors", async () => {
  const t = convexTest(schema, modules);
  const good = await grantFixture(t, "Good grant");
  const bad = await grantFixture(t, "Bad grant");
  await t.run(async (ctx) => {
    await ctx.db.insert("readinessCriteria", {
      opportunityId: bad,
      criterionKey: "hard-block",
      label: "Impossible rule",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "Must be registered.",
      hardness: "hard",
      evidenceClaimKey: "geo",
    });
  });
  const res = await t.query(api.opportunities.match, {
    state: "Lagos",
    cacStatus: "Not yet",
    asOf: AS_OF,
  });
  const order = res.map((r) => r._id);
  expect(order[0]).toBe(good);
  expect(res[0].excluded).toEqual([]);
  expect(res[0].matchTier).toBe("eligible");
  const last = res[res.length - 1];
  expect(last._id).toBe(bad);
  expect(last.excluded.length).toBeGreaterThan(0);
  expect(last.matchTier).toBe("check");
  expect(last.fit).toBe("unknown");
});

test("expired opportunities are excluded with reasons", async () => {
  const t = convexTest(schema, modules);
  const id = await grantFixture(t, "Old grant", { deadline: AS_OF - DAY });
  const res = await t.query(api.opportunities.match, { state: "Lagos", asOf: AS_OF });
  const found = res.find((r) => r._id === id)!;
  expect(found.excluded).toContain("Applications closed — the deadline has passed.");
  expect(found.matchTier).toBe("check");
});

test("matchWithFit without a key keeps the deterministic order", async () => {
  const t = convexTest(schema, modules);
  await grantFixture(t, "Grant one");
  await grantFixture(t, "Grant two");
  const args = { state: "Lagos", asOf: AS_OF };
  const plain = await t.query(api.opportunities.match, args);
  const fitted = await t.action(api.rankingActions.matchWithFit, args);
  expect(fitted.map((r) => r._id)).toEqual(plain.map((r) => r._id));
  expect(fitted.every((r) => r.fit === "unknown")).toBe(true);
});

test("excluded rows carry alternative recommendations", async () => {
  const t = convexTest(schema, modules);
  const id: Id<"opportunities"> = await grantFixture(t, "Picky grant");
  const res = await t.query(api.opportunities.match, { state: "Kano", asOf: AS_OF });
  const found = res.find((r) => r._id === id)!;
  expect(found.matchTier).toBe("check");
  expect(found.matchReasons.join(" ")).toMatch(/Lagos|eligible/i);
});
