/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seededGlowId } from "../test/convexFixtures";
import { findConflicts, judgePassageRelation } from "./evidencePolicy";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;

function row(claimKey: string, status: "supported" | "contradicted" | "pending-review" | "unsupported") {
  return { claimKey, status };
}

test("matching sources are not a conflict", () => {
  expect(findConflicts([row("fee", "supported"), row("fee", "supported")])).toEqual([]);
});

test("supported plus contradicted is a conflict", () => {
  const conflicts = findConflicts([row("fee", "supported"), row("fee", "contradicted")]);
  expect(conflicts.length).toBe(1);
  expect(conflicts[0].claimKey).toBe("fee");
  expect(conflicts[0].supported.length).toBe(1);
  expect(conflicts[0].contradicted.length).toBe(1);
});

test("partial overlap without both sides is review, not conflict", () => {
  expect(findConflicts([row("fee", "supported"), row("fee", "pending-review")])).toEqual([]);
  expect(findConflicts([row("fee", "unsupported"), row("fee", "contradicted")])).toEqual([]);
  expect(findConflicts([row("fee", "contradicted")])).toEqual([]);
});

test("passage judgments separate support, contradiction, and unrelated", async () => {
  const judge = async () => ({ relation: { choice: "contradicts", confidence: 0.9 } });
  expect(await judgePassageRelation("Fee is ₦5,000.", "There is no fee.", judge)).toEqual({
    relation: "contradicts",
    confidence: 0.9,
  });
  expect(await judgePassageRelation("Fee?", "Unrelated weather text.")).toEqual({
    relation: "uncertain",
    confidence: 0,
  });
  const weak = await judgePassageRelation("Fee?", "No fee.", async () => ({
    relation: { choice: "supports", confidence: 0.2 },
  }));
  expect(weak).toEqual({ relation: "uncertain", confidence: 0 });
});

async function seededId(t: ReturnType<typeof convexTest>) {
  return seededGlowId(t);
}

test("recording needs a real source and passage", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  await expect(
    t.mutation(api.curation.recordContradiction, {
      opportunityId: id,
      claimKey: "benefit",
      sourceUrl: "not-a-url",
      sourcePassage: "Says otherwise.",
    }),
  ).rejects.toThrow(/valid URL/);
  await expect(
    t.mutation(api.curation.recordContradiction, {
      opportunityId: id,
      claimKey: "benefit",
      sourceUrl: "https://example.org/other",
      sourcePassage: "   ",
    }),
  ).rejects.toThrow(/passage is required/);
});

test("unresolved contradictions block publication until resolved", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  await t.mutation(api.curation.recordContradiction, {
    opportunityId: id,
    claimKey: "benefit",
    sourceUrl: "https://example.org/other",
    sourcePassage: "The fund offers no financing, only training.",
  });
  const queue = await t.query(api.curation.conflictQueue, {});
  expect(queue.length).toBe(1);
  expect(queue[0].conflicts[0].claimKey).toBe("benefit");
  expect(queue[0].conflicts[0].contradicted[0].sourcePassage).toMatch(/no financing/);
  expect(queue[0].conflicts[0].supported.length).toBeGreaterThan(0);
  await expect(t.mutation(api.curation.publish, { opportunityId: id })).rejects.toThrow(
    /Unresolved contradictions.*benefit/,
  );
  const contraId = queue[0].conflicts[0].contradicted[0]._id;
  await t.mutation(api.curation.resolveEvidence, {
    evidenceId: contraId,
    status: "unsupported",
    note: "Secondary blog, official page prevails.",
  });
  await t.mutation(api.curation.publish, { opportunityId: id });
  expect(await t.query(api.curation.conflictQueue, {})).toEqual([]);
});

test("the public sees both passages with no chosen value", async () => {
  const t = convexTest(schema, modules);
  const id = await seededId(t);
  await t.mutation(api.curation.recordContradiction, {
    opportunityId: id,
    claimKey: "benefit",
    sourceUrl: "https://example.org/other",
    sourcePassage: "The fund offers no financing, only training.",
  });
  const evidence = await t.query(api.opportunities.getEvidence, { id });
  const benefitRows = (evidence?.claims ?? []).filter((c) => c.claimKey === "benefit");
  expect(benefitRows.map((c) => c.status).sort()).toEqual(["contradicted", "supported"]);
  expect(evidence?.summary.status).toBe("contradicted");
});
