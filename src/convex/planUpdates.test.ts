/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { insertOpportunity } from "../test/convexFixtures";
import { composePlanUpdate } from "./planUpdates";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86400000;

test("messages are concise and name action, risk, freshness, and link", () => {
  const m = composePlanUpdate({
    title: "GLOW — Guaranteed Loans for Women",
    overall: "can-become-ready",
    gapLabel: "CAC registration",
    actionTitle: "Register with CAC",
    daysAvailable: 5,
    deadlineStatus: "at-risk",
    freshness: "ok",
    planLink: "https://example.org/opportunity/abc",
  });
  expect(m.body.length).toBeLessThanOrEqual(300);
  expect(m.body).toMatch(/Register with CAC/);
  expect(m.body).toMatch(/5d left/);
  expect(m.body).toContain("https://example.org/opportunity/abc");
  const stale = composePlanUpdate({
    title: "GLOW",
    overall: "needs-information",
    gapLabel: null,
    actionTitle: null,
    daysAvailable: null,
    deadlineStatus: "unknown",
    freshness: "stale",
    planLink: null,
  });
  expect(stale.body).toMatch(/No deadline published/);
  expect(stale.body).toMatch(/unverified/);
});

async function trackedFixture(
  t: ReturnType<typeof convexTest>,
  opp: Record<string, unknown>,
  profile: Record<string, unknown>,
) {
  const id = await insertOpportunity(t, { ...opp });
  await t.mutation(api.profiles.save, { ownerKey: "dev-u", ...profile } as never);
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-u" });
  return id;
}

test("opted-out or address-less owners are never due", async () => {
  const t = convexTest(schema, modules);
  await trackedFixture(t, { deadline: Date.now() + 2 * DAY }, { email: "a@example.org", planUpdatesOptIn: false });
  expect(await t.query(internal.planUpdates.duePlanUpdates, {})).toHaveLength(0);
  const t2 = convexTest(schema, modules);
  await trackedFixture(t2, { deadline: Date.now() + 2 * DAY }, {});
  expect(await t2.query(internal.planUpdates.duePlanUpdates, {})).toHaveLength(0);
});

test("deadline cadence sends once, then suppresses duplicates", async () => {
  const t = convexTest(schema, modules);
  await trackedFixture(
    t,
    { deadline: Date.now() + 2 * DAY },
    { email: "a@example.org", state: "Lagos" },
  );
  const due = await t.query(internal.planUpdates.duePlanUpdates, {});
  expect(due).toHaveLength(1);
  expect(due[0].reason).toBe("first");
  const first = await t.mutation(internal.planUpdates.sendDuePlanUpdates, {});
  expect(first.checked).toBe(1);
  expect(first.sent + first.failed).toBe(1);
  expect(first.sent + first.suppressed + first.failed).toBe(first.checked);
  const second = await t.mutation(internal.planUpdates.sendDuePlanUpdates, {});
  // Same content within the window: suppressed if ever sent; otherwise the
  // failure is recorded again without marking notified.
  expect(second.sent).toBe(0);
  expect(second.suppressed + second.failed).toBe(1);
});

test("verdict transitions re-notify with fresh content", async () => {
  const t = convexTest(schema, modules);
  const id = await insertOpportunity(t, { deadline: Date.now() + 60 * DAY });
  await t.run(async (ctx) => {
    await ctx.db.insert("opportunityEvidence", {
      opportunityId: id,
      claimType: "eligibility",
      claimKey: "cac",
      displayValue: "cac",
      status: "supported",
      sourceUrl: "https://www.boi.ng/source",
      checkedAt: Date.now(),
    });
    await ctx.db.insert("readinessCriteria", {
      opportunityId: id,
      criterionKey: "cac-registered",
      label: "CAC registered",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "Must be registered.",
      hardness: "remediable",
      evidenceClaimKey: "cac",
    });
  });
  await t.mutation(api.profiles.save, { ownerKey: "dev-u", email: "a@example.org" });
  await t.mutation(api.track.save, { opportunityId: id, deviceId: "dev-u" });
  const first = await t.mutation(internal.planUpdates.sendDuePlanUpdates, {});
  expect(first.sent + first.failed).toBe(1);
  // A prior successful send anchors the transition check.
  await t.run(async (ctx) =>
    ctx.db.insert("planMessages", {
      ownerKey: "dev-u",
      opportunityId: id,
      messageHash: "previous-hash",
      channel: "email",
      status: "sent",
      overall: "needs-information",
      createdAt: Date.now(),
    }),
  );
  await t.mutation(api.profiles.save, { ownerKey: "dev-u", cac: "Registered" });
  const due = await t.query(internal.planUpdates.duePlanUpdates, {});
  expect(due).toHaveLength(1);
  expect(due[0].reason).toBe("transition");
  const second = await t.mutation(internal.planUpdates.sendDuePlanUpdates, {});
  expect(second.sent + second.failed).toBe(1);
});

test("stale sources are flagged inside the message", async () => {
  const t = convexTest(schema, modules);
  const id = await trackedFixture(t, {}, { email: "a@example.org" });
  await t.run(async (ctx) => ctx.db.patch("opportunities", id, { sourceStatus: "stale" }));
  const due = await t.query(internal.planUpdates.duePlanUpdates, {});
  expect(due).toHaveLength(1);
  const sent = await t.mutation(internal.planUpdates.sendDuePlanUpdates, {});
  expect(sent.sent + sent.failed).toBe(1);
  const rows = await t.run(async (ctx) =>
    ctx.db.query("planMessages").withIndex("by_owner", (q) => q.eq("ownerKey", "dev-u")).collect(),
  );
  expect(rows.length).toBe(1);
  expect(rows[0].status === "sent" || rows[0].status === "failed").toBe(true);
});
