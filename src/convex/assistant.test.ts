/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seededGlowId } from "../test/convexFixtures";

const modules = import.meta.glob("./**/*.ts");

test("explain returns cited answer for each mode", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  for (const mode of ["Explain simply", "What docs?", "Translate to Yoruba", "Pidgin"]) {
    const r = await t.query(api.assistant.explain, { id, mode });
    expect(r?.text.length).toBeGreaterThan(10);
    expect(r?.citation).toMatch(/Source:/);
    expect(r?.officialLink).toMatch(/^https?:/);
  }
});

test("eligibility answers carry a verified stored quote", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  const r = await t.query(api.assistant.explain, { id, mode: "Am I eligible?" });
  expect(r?.citationVerified).toBe(true);
  expect(r?.quote?.text.length).toBeGreaterThan(10);
  expect(r?.quote?.sourceUrl).toMatch(/^https?:/);
});

test("document answers fall back honestly without passages", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  const r = await t.query(api.assistant.explain, { id, mode: "What docs?" });
  expect(r?.quote).toBeNull();
  expect(r?.citationVerified).toBe(false);
  expect(r?.citationNote).toMatch(/official page/);
});

test("contradicted quotes escalate instead of showing as support", async () => {
  const t = convexTest(schema, modules);
  const id = await seededGlowId(t);
  const first = await t.query(api.assistant.explain, { id, mode: "Explain simply" });
  expect(first?.citationVerified).toBe(true);
  await t.run(async (ctx) =>
    ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "benefit",
      claimKey: "benefit",
      displayValue: first?.quote?.text ?? "benefit",
      status: "contradicted",
      sourceUrl: "https://example.org/other",
      sourcePassage: first?.quote?.text,
      checkedAt: Date.now(),
    }),
  );
  const second = await t.query(api.assistant.explain, { id, mode: "Explain simply" });
  expect(second?.citationVerified).toBe(false);
  expect(second?.quote).toBeNull();
  expect(second?.citationNote).toMatch(/disagree/);
});
