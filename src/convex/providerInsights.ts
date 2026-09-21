import { query } from "./_generated/server";
import { v } from "convex/values";
import { currentAccountEmail } from "./identity";
import { resolveProviderForEmail } from "./providers";
import { loadReadiness } from "./opportunities";
import { displayPlanState } from "./track";

// Provider access-barrier insights (issue #58).
//
// An authorized provider sees only aggregates for its own programs:
// funnel states, top blocking criteria, abandonment reasons, and outcomes
// split by reporter. Sections with fewer than MIN_COHORT distinct owners
// suppress entirely so no individual can be inferred. Consent withdrawal
// (includeInLearning false) and deletion remove rows from aggregates.

export const MIN_COHORT = 5;

const insightOpp = v.object({
  opportunityId: v.id("opportunities"),
  title: v.string(),
  suppressed: v.boolean(),
  funnel: v.array(v.object({ state: v.string(), count: v.number() })),
  topGaps: v.array(v.object({ label: v.string(), count: v.number() })),
  abandonReasons: v.array(v.object({ reason: v.string(), count: v.number() })),
  outcomes: v.array(
    v.object({ outcome: v.string(), reportedBy: v.string(), reasonCode: v.union(v.string(), v.null()), count: v.number() }),
  ),
});

export const myProviderInsights = query({
  args: {},
  returns: v.object({
    providerName: v.string(),
    opportunities: v.array(insightOpp),
  }),
  handler: async (ctx) => {
    const email = await currentAccountEmail(ctx);
    if (!email) throw new Error("Sign in with your provider email.");
    const providers = await ctx.db.query("providers").take(50);
    const provider = resolveProviderForEmail(
      email,
      providers.map((p) => ({ _id: String(p._id), name: p.name, officialLink: p.officialLink, authorizedEmails: p.authorizedEmails })),
    );
    if (!provider) throw new Error("No provider program is linked to this email.");
    const opportunities = await ctx.db.query("opportunities").take(100);
    const mine = opportunities.filter((o) => o.providerName === provider.name);
    const out = [];
    for (const opp of mine) {
      const tracks = await ctx.db
        .query("track")
        .take(200);
      const mine = tracks.filter((r) => r.opportunityId === opp._id);
      const owners = [...new Set(mine.map((r) => r.deviceId))];
      if (owners.length < MIN_COHORT) {
        out.push({
          opportunityId: opp._id,
          title: opp.title,
          suppressed: true,
          funnel: [],
          topGaps: [],
          abandonReasons: [],
          outcomes: [],
        });
        continue;
      }
      const funnel = new Map<string, number>();
      const abandon = new Map<string, number>();
      const gapCounts = new Map<string, number>();
      for (const r of mine) {
        const state = displayPlanState(r.status);
        funnel.set(state, (funnel.get(state) ?? 0) + 1);
        if (state === "abandoned" && r.abandonReason) {
          abandon.set(r.abandonReason, (abandon.get(r.abandonReason) ?? 0) + 1);
        }
      }
      for (const owner of owners) {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_owner", (q) => q.eq("ownerKey", owner))
          .unique();
        const { assessments } = await loadReadiness(ctx, opp._id, {
          state: profile?.state,
          sector: profile?.sector,
          businessStage: profile?.businessStage,
          cac: profile?.cac,
          staffSize: profile?.staffSize,
          age: profile?.age,
          womenLed: profile?.womenLed,
        });
          for (const a of assessments) {
          if (a.result === "unmet") {
            gapCounts.set(a.label, (gapCounts.get(a.label) ?? 0) + 1);
          }
        }
      }
      const outcomeRows = await ctx.db.query("planOutcomes").take(500);
      const outcomeCounts = new Map<string, number>();
      for (const oc of outcomeRows) {
        if (!oc.includeInLearning) continue;
        if (oc.opportunityId !== opp._id) continue;
        const key = `${oc.outcome}||${oc.reportedBy}||${oc.reasonCode ?? ""}`;
        outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
      }
      const top = (m: Map<string, number>, n: number) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
      out.push({
        opportunityId: opp._id,
        title: opp.title,
        suppressed: false,
        funnel: top(funnel, 8).map(([state, count]) => ({ state, count })),
        topGaps: top(gapCounts, 5).map(([label, count]) => ({ label, count })),
        abandonReasons: top(abandon, 5).map(([reason, count]) => ({ reason, count })),
        outcomes: [...outcomeCounts.entries()].map(([key, count]) => {
          const [outcome, reportedBy, reasonCode] = key.split("||");
          return { outcome, reportedBy, reasonCode: reasonCode || null, count };
        }),
      });
    }
    return { providerName: provider.name, opportunities: out };
  },
});
