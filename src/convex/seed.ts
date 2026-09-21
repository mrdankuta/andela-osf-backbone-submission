import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  SEEDED_CATALOG,
  SEEDED_PROVIDERS,
  type SeedCriterion,
  type SeedEvidence,
  type SeedGuide,
} from "./seedCatalog";

async function replaceChildren(
  ctx: MutationCtx,
  opportunityId: Id<"opportunities">,
  rows: { evidence: SeedEvidence[]; criteria: SeedCriterion[]; guides: SeedGuide[] },
) {
  const existingEvidence = await ctx.db
    .query("opportunityEvidence")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(100);
  for (const row of existingEvidence) {
    await ctx.db.delete("opportunityEvidence", row._id);
  }
  for (const claim of rows.evidence) {
    await ctx.db.insert("opportunityEvidence", { opportunityId, ...claim });
  }

  const existingCriteria = await ctx.db
    .query("readinessCriteria")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(100);
  for (const row of existingCriteria) {
    await ctx.db.delete("readinessCriteria", row._id);
  }
  for (const criterion of rows.criteria) {
    await ctx.db.insert("readinessCriteria", { opportunityId, ...criterion });
  }

  const existingGuides = await ctx.db
    .query("readinessGuides")
    .withIndex("by_opportunityId", (q) => q.eq("opportunityId", opportunityId))
    .take(100);
  for (const row of existingGuides) {
    await ctx.db.delete("readinessGuides", row._id);
  }
  for (const guide of rows.guides) {
    await ctx.db.insert("readinessGuides", { opportunityId, ...guide });
  }
}

export const seed = internalMutation({
  args: {},
  returns: v.object({ seeded: v.boolean(), count: v.literal(6) }),
  handler: async (ctx) => {
    for (const provider of SEEDED_PROVIDERS) {
      const existing = await ctx.db
        .query("providers")
        .withIndex("by_name", (q) => q.eq("name", provider.name))
        .unique();
      if (!existing) {
        await ctx.db.insert("providers", provider);
      } else if (
        existing.type !== provider.type ||
        existing.verified !== provider.verified ||
        existing.officialLink !== provider.officialLink
      ) {
        await ctx.db.patch("providers", existing._id, {
          type: provider.type,
          verified: provider.verified,
          officialLink: provider.officialLink,
        });
      }
    }

    const seededUrls = new Set(SEEDED_CATALOG.map((entry) => entry.opportunity.sourceUrl));
    for (const status of ["verified", "unverified", "expired"] as const) {
      const rows = await ctx.db
        .query("opportunities")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(100);
      for (const o of rows) {
        if (seededUrls.has(o.sourceUrl)) continue;
        if (o.catalogVisibility !== "hidden") {
          await ctx.db.patch("opportunities", o._id, { catalogVisibility: "hidden" });
        }
      }
    }

    let inserted = false;
    for (const entry of SEEDED_CATALOG) {
      const sameSource = await ctx.db
        .query("opportunities")
        .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", entry.opportunity.sourceUrl))
        .take(100);
      const canonical = sameSource[0];
      let id: Id<"opportunities">;
      if (canonical) {
        for (const dup of sameSource.slice(1)) {
          if (dup.catalogVisibility !== "hidden") {
            await ctx.db.patch("opportunities", dup._id, { catalogVisibility: "hidden" });
          }
        }
        await ctx.db.replace("opportunities", canonical._id, entry.opportunity);
        id = canonical._id;
      } else {
        id = await ctx.db.insert("opportunities", entry.opportunity);
        inserted = true;
      }
      await replaceChildren(ctx, id, {
        evidence: entry.evidence,
        criteria: entry.criteria,
        guides: entry.guides,
      });
    }
    return { seeded: inserted, count: 6 as const };
  },
});
