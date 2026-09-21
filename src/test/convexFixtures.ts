import type { TestConvex } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

type OpportunityInsert = Omit<Doc<"opportunities">, "_id" | "_creationTime">;

export function publicOpportunity(
  overrides: Partial<OpportunityInsert> = {},
): OpportunityInsert {
  return {
    title: "BOI MSME Support — verified fixture",
    providerName: "Bank of Industry",
    providerType: "Bank",
    type: "loan",
    amountOrBenefit: "₦5M facility",
    deadline: Date.now() + 10 * 86400000,
    locationEligibility: "All Nigeria",
    sectorTags: ["all"],
    summaryPlain: "Fixture opportunity backed by official BOI sources.",
    eligibilityRules: ["Nigerian MSME", "18+"],
    steps: [
      {
        order: 1,
        title: "Apply online",
        detail: "Submit via the official portal.",
        link: "https://www.boi.ng",
      },
    ],
    documents: [],
    contacts: { officialLink: "https://www.boi.ng" },
    sourceUrl: "https://www.boi.ng/msme-support",
    lastVerified: Date.now(),
    status: "verified",
    catalogVisibility: "public",
    ...overrides,
  };
}

export async function insertOpportunity(
  t: TestConvex<typeof schema>,
  overrides: Partial<OpportunityInsert> = {},
): Promise<Id<"opportunities">> {
  const doc = publicOpportunity(overrides);
  return await t.run(async (ctx) => await ctx.db.insert("opportunities", doc));
}

export async function seededGlow(
  t: TestConvex<typeof schema>,
): Promise<Doc<"opportunities">> {
  await t.mutation(internal.seed.seed, {});
  const items = await t.query(api.opportunities.list, {});
  const glow = items.find((o) => o.title.includes("GLOW"));
  if (!glow) throw new Error("Seeded GLOW opportunity not found");
  return glow;
}

export async function seededGlowId(
  t: TestConvex<typeof schema>,
): Promise<Id<"opportunities">> {
  return (await seededGlow(t))._id;
}
