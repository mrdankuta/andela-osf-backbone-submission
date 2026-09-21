import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { effectiveOwnerKey } from "./identity";
import { displayPlanState } from "./track";
import { requireCurator, reviewerIdentity } from "./curation";

// Community success stories (follow-up #21).
//
// Opt-in stories submit from applied track rows and stay invisible until
// a curator approves. Public output carries no owner identifiers.

const MAX_STORY_CHARS = 600;

export const submitStory = mutation({
  args: { ownerKey: v.string(), opportunityId: v.id("opportunities"), story: v.string() },
  returns: v.id("successStories"),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const text = args.story.trim();
    if (text.length < 20) throw new Error("Tell us a little more (at least 20 characters).");
    if (text.length > MAX_STORY_CHARS) {
      throw new Error(`Keep it under ${MAX_STORY_CHARS} characters for low-data readers.`);
    }
    const rows = await ctx.db
      .query("track")
      .withIndex("by_device", (q) => q.eq("deviceId", ownerKey))
      .take(50);
    const row = rows.find((r) => r.opportunityId === args.opportunityId);
    if (!row || displayPlanState(row.status) !== "applied") {
      throw new Error("Stories open up once you've marked an application applied.");
    }
    return await ctx.db.insert("successStories", {
      ownerKey,
      opportunityId: args.opportunityId,
      story: text,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const reviewStory = mutation({
  args: { storyId: v.id("successStories"), approved: v.boolean() },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const row = await ctx.db.get("successStories", args.storyId);
    if (!row) throw new Error("Story not found.");
    const reviewer = await reviewerIdentity(ctx);
    await ctx.db.patch("successStories", args.storyId, {
      status: args.approved ? "approved" : "rejected",
      decidedAt: Date.now(),
      decidedBy: reviewer,
    });
    return true as const;
  },
});

export const deleteStory = mutation({
  args: { ownerKey: v.string(), storyId: v.id("successStories") },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const row = await ctx.db.get("successStories", args.storyId);
    if (!row || row.ownerKey !== ownerKey) return null;
    await ctx.db.delete("successStories", args.storyId);
    return true as const;
  },
});

export const publishedStories = query({
  args: { opportunityId: v.id("opportunities") },
  returns: v.array(v.object({ story: v.string(), createdAt: v.number() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("successStories").withIndex("by_status", (q) => q.eq("status", "approved")).take(20);
    return rows
      .filter((r) => r.opportunityId === args.opportunityId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ story: r.story, createdAt: r.createdAt }));
  },
});

export const myStories = query({
  args: { ownerKey: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("successStories"),
      opportunityId: v.id("opportunities"),
      story: v.string(),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const rows = await ctx.db
      .query("successStories")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .take(20);
    return rows.map((r) => ({
      _id: r._id,
      opportunityId: r.opportunityId,
      story: r.story,
      status: r.status,
      createdAt: r.createdAt,
    }));
  },
});

export const pendingStories = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("successStories"),
      opportunityTitle: v.string(),
      story: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireCurator(ctx);
    const rows = await ctx.db
      .query("successStories")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(20);
    const out = [];
    for (const r of rows) {
      const opp = await ctx.db.get("opportunities", r.opportunityId);
      out.push({ _id: r._id, opportunityTitle: opp?.title ?? "Unknown", story: r.story, createdAt: r.createdAt });
    }
    return out;
  },
});
