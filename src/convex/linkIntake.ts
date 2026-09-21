import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { normalizeSharedUrl } from "../lib/linkNormalize";
import { readFreshness } from "./sourceMonitor";
import { requireCurator } from "./curation";

// WhatsApp-friendly link intake (issue #43).
//
// A pasted forward resolves to exactly one outcome: a known verified
// opportunity (with trust + freshness shown first), an in-review record,
// or an unknown link that can be suggested for curator review. Unknown
// links never receive verified labels or invented details.

const freshnessValidator = v.union(
  v.object({
    state: v.union(
      v.literal("ok"),
      v.literal("stale"),
      v.literal("unavailable"),
      v.literal("under-review"),
      v.literal("closed"),
    ),
    lastChecked: v.union(v.number(), v.null()),
  }),
  v.null(),
);

export const resolveLink = query({
  args: { url: v.string() },
  returns: v.union(
    v.object({
      outcome: v.literal("invalid"),
      normalizedUrl: v.union(v.string(), v.null()),
    }),
    v.object({
      outcome: v.literal("known"),
      normalizedUrl: v.string(),
      opportunityId: v.id("opportunities"),
      title: v.string(),
      providerName: v.string(),
      amountOrBenefit: v.string(),
      sourceUrl: v.string(),
      lastVerified: v.number(),
      freshness: freshnessValidator,
    }),
    v.object({
      outcome: v.literal("in-review"),
      normalizedUrl: v.string(),
      detail: v.string(),
    }),
    v.object({
      outcome: v.literal("unknown"),
      normalizedUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeSharedUrl(args.url);
    if (!normalized) return { outcome: "invalid" as const, normalizedUrl: null };
    const opportunities = await ctx.db.query("opportunities").take(100);
    for (const o of opportunities) {
      const sources = [o.sourceUrl, o.contacts.officialLink];
      if (!sources.some((s) => normalizeSharedUrl(s) === normalized)) continue;
      if (o.status === "verified" && o.catalogVisibility === "public") {
        return {
          outcome: "known" as const,
          normalizedUrl: normalized,
          opportunityId: o._id,
          title: o.title,
          providerName: o.providerName,
          amountOrBenefit: o.amountOrBenefit,
          sourceUrl: o.sourceUrl,
          lastVerified: o.lastVerified,
          freshness: await readFreshness(ctx, o._id),
        };
      }
      return {
        outcome: "in-review" as const,
        normalizedUrl: normalized,
        detail:
          o.status === "expired"
            ? "This programme has closed."
            : "Our curators have seen this link — it is not verified yet.",
      };
    }
    const drafts = await ctx.db.query("importDrafts").take(100);
    if (drafts.some((d) => normalizeSharedUrl(d.sourceUrl) === normalized)) {
      return {
        outcome: "in-review" as const,
        normalizedUrl: normalized,
        detail: "Our curators are reviewing this link — it is not verified yet.",
      };
    }
    return { outcome: "unknown" as const, normalizedUrl: normalized };
  },
});

export const suggestLink = mutation({
  args: { url: v.string(), deviceId: v.optional(v.string()) },
  returns: v.union(
    v.object({ suggestionId: v.id("linkSuggestions"), duplicate: v.boolean(), normalizedUrl: v.string() }),
    v.object({ outcome: v.literal("known"), normalizedUrl: v.string() }),
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeSharedUrl(args.url);
    if (!normalized) throw new Error("That doesn't look like a link. Paste the full URL from the forward.");
    const opportunities = await ctx.db.query("opportunities").take(100);
    if (
      opportunities.some((o) =>
        [o.sourceUrl, o.contacts.officialLink].some((s) => normalizeSharedUrl(s) === normalized),
      )
    ) {
      return { outcome: "known" as const, normalizedUrl: normalized };
    }
    const existing = await ctx.db
      .query("linkSuggestions")
      .withIndex("by_normalizedUrl", (q) => q.eq("normalizedUrl", normalized))
      .take(10);
    const open = existing.find((s) => s.status === "suggested");
    if (open) return { suggestionId: open._id, duplicate: true, normalizedUrl: normalized };
    const suggestionId = await ctx.db.insert("linkSuggestions", {
      url: args.url.trim(),
      normalizedUrl: normalized,
      deviceId: args.deviceId,
      createdAt: Date.now(),
      status: "suggested",
    });
    return { suggestionId, duplicate: false, normalizedUrl: normalized };
  },
});

export const listSuggestions = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("linkSuggestions"),
      url: v.string(),
      normalizedUrl: v.string(),
      createdAt: v.number(),
      status: v.union(v.literal("suggested"), v.literal("imported"), v.literal("declined")),
      draftId: v.optional(v.id("importDrafts")),
    }),
  ),
  handler: async (ctx) => {
    await requireCurator(ctx);
    const rows = await ctx.db
      .query("linkSuggestions")
      .withIndex("by_status", (q) => q.eq("status", "suggested"))
      .take(30);
    return rows.map((r) => ({
      _id: r._id,
      url: r.url,
      normalizedUrl: r.normalizedUrl,
      createdAt: r.createdAt,
      status: r.status,
      draftId: r.draftId,
    }));
  },
});

export const resolveSuggestion = mutation({
  args: {
    suggestionId: v.id("linkSuggestions"),
    outcome: v.union(v.literal("imported"), v.literal("declined")),
    draftId: v.optional(v.id("importDrafts")),
  },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const row = await ctx.db.get("linkSuggestions", args.suggestionId);
    if (!row) throw new Error("Suggestion not found.");
    await ctx.db.patch("linkSuggestions", args.suggestionId, {
      status: args.outcome,
      draftId: args.draftId,
    });
    return true as const;
  },
});
