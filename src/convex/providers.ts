import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurator } from "./curation";
import { entitySiteFamily } from "./entityResolutionPolicy";

export const listProviders = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("providers").take(50);
  },
});

export const upsert = mutation({
  args: {
    name: v.string(),
    type: v.string(),
    verified: v.boolean(),
    contact: v.optional(v.string()),
    officialLink: v.optional(v.string()),
  },
  returns: v.id("providers"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("providers").withIndex("by_name", (q) => q.eq("name", args.name)).unique();
    if (!existing) {
      return await ctx.db.insert("providers", args);
    }
    await ctx.db.patch("providers", existing._id, args);
    return existing._id;
  },
});

export type ProviderDoc = {
  _id: string;
  name: string;
  officialLink?: string;
  authorizedEmails?: string[];
};

/** Resolve which provider an email may see: explicit allowlist first,
 *  otherwise the registrable domain of the provider's official link. */
export function resolveProviderForEmail(
  email: string,
  providers: ProviderDoc[],
): ProviderDoc | null {
  const lower = email.toLowerCase();
  const listed = providers.find((p) =>
    (p.authorizedEmails ?? []).some((e) => e.toLowerCase() === lower),
  );
  if (listed) return listed;
  const domain = lower.split("@")[1] ?? "";
  const match = providers.find((p) => {
    const family = entitySiteFamily(p.officialLink);
    return family !== null && (domain === family || domain.endsWith(`.${family}`));
  });
  return match ?? null;
}

export const setProviderAccess = mutation({
  args: { providerId: v.id("providers"), emails: v.array(v.string()) },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const provider = await ctx.db.get("providers", args.providerId);
    if (!provider) throw new Error("Provider not found.");
    await ctx.db.patch("providers", args.providerId, {
      authorizedEmails: args.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
    });
    return true as const;
  },
});
