/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import type { Id } from "./_generated/dataModel";
import { routeRequest } from "./assistantRouter";

const modules = import.meta.glob("./**/*.ts");
const AS_OF = 1_800_000_000_000;

test("evidence requests route to the evidence function", () => {
  expect(routeRequest("What evidence supports the women-led claim?").route).toBe("evidence");
  expect(routeRequest("Show me the sources behind this decision.").route).toBe("evidence");
});

test("criterion requests route to the criterion function", () => {
  expect(routeRequest("Am I eligible for this loan?").route).toBe("criterion");
  expect(routeRequest("What does the CAC registration rule mean?").route).toBe("criterion");
});

test("next-action requests route to the next-action function", () => {
  expect(routeRequest("What should I do next to apply?").route).toBe("next-action");
  expect(routeRequest("How do I get my CAC certificate?").route).toBe("next-action");
});

test("alternative requests route to the alternative function", () => {
  expect(routeRequest("Is there another option since I am blocked?").route).toBe("alternative");
  expect(routeRequest("I missed the deadline, what instead?").route).toBe("alternative");
});

test("ambiguous intent triggers clarification instead of a guessed call", () => {
  const res = routeRequest("Tell me about eligibility and my next steps");
  expect(res.route).toBe("clarify");
  expect(res.clarifyingQuestion).toMatch(/eligibility criterion|next step/);
});

test("requests with no clear intent trigger clarification", () => {
  const res = routeRequest("help");
  expect(res.route).toBe("clarify");
  expect(res.clarifyingQuestion).toMatch(/evidence/);
});

test("out-of-domain requests are unsupported", () => {
  expect(routeRequest("Write my business plan for me").route).toBe("unsupported");
  expect(routeRequest("Lend me five million naira").route).toBe("unsupported");
});

async function insertEvidence(
  t: ReturnType<typeof convexTest>,
  opportunityId: Id<"opportunities">,
) {
  await t.run(async (ctx) =>
    ctx.db.insert("opportunityEvidence", {
      opportunityId,
      claimType: "eligibility",
      claimKey: "cac-registered",
      displayValue: "CAC registered",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      sourcePassage: "Must be CAC registered.",
      checkedAt: AS_OF,
    }),
  );
}

async function readyFixture(t: ReturnType<typeof convexTest>) {
  const id = await insertOpportunity(t, {});
  await insertEvidence(t, id);
  await t.run(async (ctx) => {
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "cac-registered",
      label: "CAC registered",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "The business must be CAC registered.",
      hardness: "remediable",
      evidenceClaimKey: "cac-registered",
      guidance: "Register with CAC.",
    });
    await ctx.db.insert("readinessGuides", {
      opportunityId: id,
      criterionKey: "cac-registered",
      title: "Register with CAC",
      detail: "Visit the CAC portal.",
      sourceUrl: "https://www.boi.ng/guide",
      costEstimate: "No cost is published.",
      dependencies: ["Business name"],
      uncertainty: "Timelines vary.",
      alternativeTitle: "Compare another opportunity",
      alternativeDetail: "Look elsewhere.",
    });
  });
  return id;
}

test("answerRequest executes the evidence function with citations, no AI needed", async () => {
  const t = convexTest(schema, modules);
  const id = await readyFixture(t);
  const res = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "Show me the evidence for the CAC claim?",
  });
  expect(res?.route).toBe("evidence");
  expect(res?.reply).toMatch(/1\/1 key claims supported/);
  expect(res?.citations).toContain("https://www.boi.ng/source");
});

test("answerRequest executes the criterion function and keeps the verdict", async () => {
  const t = convexTest(schema, modules);
  const id = await readyFixture(t);
  const res = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "Am I eligible?",
    facts: { cac: "Not yet" },
  });
  expect(res?.route).toBe("criterion");
  expect(res?.reply).toMatch(/Readiness verdict: can-become-ready/);
  expect(res?.reply).toMatch(/CAC registered: unmet/);
});

test("answerRequest executes the next-action function with uncertainty", async () => {
  const t = convexTest(schema, modules);
  const id = await readyFixture(t);
  const res = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "What should I do next?",
    facts: { cac: "Not yet" },
    asOf: AS_OF,
  });
  expect(res?.route).toBe("next-action");
  expect(res?.reply).toMatch(/Register with CAC/);
  expect(res?.reply).toMatch(/Official portal:/);
  expect(res?.uncertainty).toMatch(/Timelines vary/);
  expect(res?.citations).toContain("https://www.boi.ng/guide");
});

test("answerRequest reports the deterministic verdict when blocked, never overriding it", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "nigeria-only",
      label: "Operates in Nigeria",
      profileField: "state",
      operator: "equals",
      expectedValues: ["Lagos"],
      requirement: "Must operate in Lagos.",
      hardness: "hard",
      evidenceClaimKey: "nigeria-only",
    });
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "nigeria-only",
      displayValue: "Operates in Nigeria",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      checkedAt: AS_OF,
    });
  });
  const res = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "What should I do next?",
    facts: { state: "Kano" },
    asOf: AS_OF,
  });
  expect(res?.route).toBe("next-action");
  expect(res?.reply).toMatch(/unmet.*hard|hard.*unmet/s);
  expect(res?.reply).not.toMatch(/You look ready/);
});

test("answerRequest serves alternatives from the plan", async () => {
  const t = convexTest(schema, modules);
  const id = await readyFixture(t);
  const res = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "Is there another option?",
    facts: { cac: "Not yet" },
    asOf: AS_OF,
  });
  expect(res?.route).toBe("alternative");
  expect(res?.reply).toMatch(/Compare another opportunity|no alternative/i);
});

test("clarify and unsupported replies make no function call and cite nothing invented", async () => {
  const t = convexTest(schema, modules);
  const id = await readyFixture(t);
  const clarify = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "Tell me about eligibility and my next steps",
  });
  expect(clarify?.route).toBe("clarify");
  expect(clarify?.citations).toEqual([]);
  expect(clarify?.clarifyingQuestion).toBeTruthy();
  const unsupported = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "Write my business plan for me",
  });
  expect(unsupported?.route).toBe("unsupported");
  expect(unsupported?.reply).toMatch(/only help with/);
});

test("answerRequest returns null for unknown opportunities", async () => {
  const t = convexTest(schema, modules);
  const id = await readyFixture(t);
  await t.run(async (ctx) => ctx.db.delete(id));
  const res = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "Am I eligible?",
  });
  expect(res).toBeNull();
});

test("agent instructions forbid overriding typed readiness results", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/convex/agentDef.ts", "utf8");
  expect(source).toMatch(/never soften a blocked verdict/);
  expect(source).toMatch(/never upgrade needs-information/);
});

test("non-public opportunities stay unauthorized", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { catalogVisibility: "hidden" });
  const res = await t.query(api.assistantRouter.answerRequest, {
    opportunityId: id,
    text: "Am I eligible?",
  });
  expect(res).toBeNull();
});
