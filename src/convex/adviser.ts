import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { currentIdentity } from "./identity";
import { buildReadinessPlan, readinessPlanValidator } from "./opportunities";
import { coerceFactValue } from "./answerLedger";
import { displayPlanState, listPlansForOwner, PLAN_TRANSITIONS } from "./track";

// Adviser access with scoped consent (issue #54).
//
// The entrepreneur generates an invite code; the adviser redeems it. Every
// adviser call checks an active grant for scope and opportunity, attributes
// actions in the grant audit, and never overwrites entrepreneur-confirmed
// facts (adviser answers land as opportunity-scoped overrides). Revocation
// takes effect on the next call and preserves history for the entrepreneur.

export const ADVISER_SCOPES = ["plan:view", "plan:update", "answers:confirm", "documents:view"] as const;

export const INVITE_TTL_MS = 7 * 86400000;

const scopeValidator = v.union(
  v.literal("plan:view"),
  v.literal("plan:update"),
  v.literal("answers:confirm"),
  v.literal("documents:view"),
);

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function requireAccountKey(ctx: QueryCtx | MutationCtx): Promise<string> {
  const ident = await currentIdentity(ctx);
  if (ident.kind !== "user") throw new Error("Sign in to manage adviser access.");
  return ident.id;
}

type GrantDoc = {
  _id: Id<"adviserGrants">;
  entrepreneurKey: string;
  adviserKey: string;
  label: string;
  scopes: string[];
  opportunityIds: string[];
  status: "active" | "revoked";
};

async function activeGrant(
  ctx: QueryCtx | MutationCtx,
  entrepreneurKey: string,
  adviserKey: string,
): Promise<GrantDoc | null> {
  const rows = await ctx.db
    .query("adviserGrants")
    .withIndex("by_entrepreneur", (q) => q.eq("entrepreneurKey", entrepreneurKey))
    .take(20);
  const hit = rows.find((r) => r.adviserKey === adviserKey && r.status === "active");
  return (hit as GrantDoc | undefined) ?? null;
}

async function requireGrant(
  ctx: QueryCtx | MutationCtx,
  entrepreneurKey: string,
  adviserKey: string,
  scope: string,
  opportunityId?: string,
): Promise<GrantDoc> {
  const grant = await activeGrant(ctx, entrepreneurKey, adviserKey);
  if (!grant) throw new Error("No active consent from this entrepreneur.");
  if (!grant.scopes.includes(scope)) throw new Error(`This consent does not include ${scope}.`);
  if (
    opportunityId &&
    grant.opportunityIds.length > 0 &&
    !grant.opportunityIds.includes(opportunityId)
  ) {
    throw new Error("This consent does not cover that opportunity.");
  }
  return grant;
}

async function audit(
  ctx: MutationCtx,
  grantId: Id<"adviserGrants">,
  actorKey: string,
  action: string,
  detail?: string,
): Promise<void> {
  const grant = await ctx.db.get("adviserGrants", grantId);
  if (!grant) return;
  const trail = [...grant.audit, { at: Date.now(), actorKey, action, detail }];
  await ctx.db.patch("adviserGrants", grantId, { audit: trail.slice(-100) });
}

export const createInvite = mutation({
  args: {
    label: v.string(),
    scopes: v.array(scopeValidator),
    opportunityIds: v.optional(v.array(v.string())),
  },
  returns: v.object({ code: v.string() }),
  handler: async (ctx, args) => {
    const entrepreneurKey = await requireAccountKey(ctx);
    if (!args.label.trim()) throw new Error("Name this adviser so you recognize them.");
    if (args.scopes.length === 0) throw new Error("Grant at least one scope.");
    let code = inviteCode();
    for (let i = 0; i < 3; i++) {
      const clash = await ctx.db.query("adviserInvites").withIndex("by_code", (q) => q.eq("code", code)).unique();
      if (!clash) break;
      code = inviteCode();
    }
    await ctx.db.insert("adviserInvites", {
      code,
      entrepreneurKey,
      label: args.label.trim(),
      scopes: [...args.scopes],
      opportunityIds: args.opportunityIds ?? [],
      status: "pending",
      createdAt: Date.now(),
    });
    return { code };
  },
});

export const redeemInvite = mutation({
  args: { code: v.string() },
  returns: v.object({ grantId: v.id("adviserGrants"), entrepreneurKey: v.string() }),
  handler: async (ctx, args) => {
    const adviserKey = await requireAccountKey(ctx);
    const code = args.code.trim().toUpperCase();
    const invite = await ctx.db.query("adviserInvites").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!invite || invite.status !== "pending") throw new Error("This invite is not valid.");
    if (Date.now() - invite.createdAt > INVITE_TTL_MS) {
      await ctx.db.patch("adviserInvites", invite._id, { status: "expired", decidedAt: Date.now() });
      throw new Error("This invite has expired. Ask for a fresh code.");
    }
    if (invite.entrepreneurKey === adviserKey) throw new Error("You cannot advise yourself.");
    const existing = await activeGrant(ctx, invite.entrepreneurKey, adviserKey);
    if (existing) throw new Error("Access already granted — ask them to revoke it first to change scopes.");
    await ctx.db.patch("adviserInvites", invite._id, { status: "accepted", decidedAt: Date.now() });
    const grantId = await ctx.db.insert("adviserGrants", {
      entrepreneurKey: invite.entrepreneurKey,
      adviserKey,
      label: invite.label,
      scopes: [...invite.scopes],
      opportunityIds: [...invite.opportunityIds],
      status: "active",
      audit: [{ at: Date.now(), actorKey: adviserKey, action: "redeemed", detail: `Invite ${code}` }],
      createdAt: Date.now(),
    });
    return { grantId, entrepreneurKey: invite.entrepreneurKey };
  },
});

const grantValidator = v.object({
  _id: v.id("adviserGrants"),
  entrepreneurKey: v.string(),
  adviserKey: v.string(),
  label: v.string(),
  scopes: v.array(v.string()),
  opportunityIds: v.array(v.string()),
  status: v.union(v.literal("active"), v.literal("revoked")),
  revokedAt: v.optional(v.number()),
});

export const myGrants = query({
  args: {},
  returns: v.array(grantValidator),
  handler: async (ctx) => {
    const key = await requireAccountKey(ctx);
    const rows = await ctx.db
      .query("adviserGrants")
      .withIndex("by_entrepreneur", (q) => q.eq("entrepreneurKey", key))
      .take(20);
    return rows.map((r) => ({
      _id: r._id,
      entrepreneurKey: r.entrepreneurKey,
      adviserKey: r.adviserKey,
      label: r.label,
      scopes: r.scopes,
      opportunityIds: r.opportunityIds,
      status: r.status,
      revokedAt: r.revokedAt,
    }));
  },
});

export const myAdvising = query({
  args: {},
  returns: v.array(
    grantValidator.extend({
      entrepreneurLabel: v.string(),
      audit: v.array(
        v.object({ at: v.number(), actorKey: v.string(), action: v.string(), detail: v.optional(v.string()) }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const key = await requireAccountKey(ctx);
    const rows = await ctx.db
      .query("adviserGrants")
      .withIndex("by_adviser", (q) => q.eq("adviserKey", key))
      .take(20);
    return rows.map((r) => ({
      _id: r._id,
      entrepreneurKey: r.entrepreneurKey,
      adviserKey: r.adviserKey,
      label: r.label,
      scopes: r.scopes,
      opportunityIds: r.opportunityIds,
      status: r.status,
      revokedAt: r.revokedAt,
      entrepreneurLabel: r.label,
      audit: r.audit,
    }));
  },
});

export const revokeGrant = mutation({
  args: { grantId: v.id("adviserGrants") },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    const key = await requireAccountKey(ctx);
    const grant = await ctx.db.get("adviserGrants", args.grantId);
    if (!grant || grant.entrepreneurKey !== key) throw new Error("Grant not found.");
    if (grant.status !== "active") return true as const;
    await ctx.db.patch("adviserGrants", args.grantId, { status: "revoked", revokedAt: Date.now() });
    await audit(ctx, args.grantId, key, "revoked");
    return true as const;
  },
});

export const adviserPlans = query({
  args: { entrepreneurKey: v.string() },
  returns: v.array(
    v.object({
      opportunityId: v.id("opportunities"),
      title: v.string(),
      displayState: v.string(),
      progress: v.number(),
      nextStep: v.string(),
      ticked: v.array(v.number()),
      steps: v.array(v.object({ order: v.number(), title: v.string() })),
      readinessOverall: v.union(
        v.literal("ready"),
        v.literal("can-become-ready"),
        v.literal("not-currently-eligible"),
        v.literal("needs-information"),
        v.null(),
      ),
      nextDependency: v.union(v.object({ label: v.string(), guidance: v.string() }), v.null()),
      deadlineRisk: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const adviserKey = await requireAccountKey(ctx);
    await requireGrant(ctx, args.entrepreneurKey, adviserKey, "plan:view");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.entrepreneurKey))
      .unique();
    const facts = {
      state: profile?.state,
      sector: profile?.sector,
      businessStage: profile?.businessStage,
      cac: profile?.cac,
      staffSize: profile?.staffSize,
      age: profile?.age,
      womenLed: profile?.womenLed,
    };
    const rows = await listPlansForOwner(ctx, args.entrepreneurKey, facts);
    return rows.map((r) => ({
      opportunityId: r.opportunityId,
      title: r.opportunity.title,
      displayState: r.displayState,
      progress: r.progress,
      nextStep: r.nextStep,
      ticked: r.ticked,
      steps: r.opportunity.steps.map((s) => ({ order: s.order, title: s.title })),
      readinessOverall: r.readinessOverall,
      nextDependency: r.nextDependency,
      deadlineRisk: r.deadlineRisk,
    }));
  },
});

export const adviserReadiness = query({
  args: { entrepreneurKey: v.string(), opportunityId: v.id("opportunities") },
  returns: readinessPlanValidator,
  handler: async (ctx, args) => {
    const adviserKey = await requireAccountKey(ctx);
    await requireGrant(ctx, args.entrepreneurKey, adviserKey, "plan:view", args.opportunityId);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.entrepreneurKey))
      .unique();
    const overrides = await ctx.db
      .query("answerOverrides")
      .withIndex("by_owner_opportunity", (q) =>
        q.eq("ownerKey", args.entrepreneurKey).eq("opportunityId", args.opportunityId),
      )
      .take(20);
    const facts: Record<string, string | number | boolean | undefined> = {
      state: profile?.state,
      sector: profile?.sector,
      businessStage: profile?.businessStage,
      cac: profile?.cac,
      staffSize: profile?.staffSize,
      age: profile?.age,
      womenLed: profile?.womenLed,
    };
    for (const o of overrides) facts[o.profileField] = coerceFactValue(o.value, o.valueType);
    return await buildReadinessPlan(ctx, args.opportunityId, { ...facts, asOf: Date.now() });
  },
});

export const adviserTick = mutation({
  args: { entrepreneurKey: v.string(), opportunityId: v.id("opportunities"), step: v.number() },
  returns: v.array(v.number()),
  handler: async (ctx, args) => {
    const adviserKey = await requireAccountKey(ctx);
    const grant = await requireGrant(ctx, args.entrepreneurKey, adviserKey, "plan:update", args.opportunityId);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    const rows = await ctx.db
      .query("track")
      .withIndex("by_device", (q) => q.eq("deviceId", args.entrepreneurKey))
      .take(50);
    let row = rows.find((r) => r.opportunityId === args.opportunityId);
    if (!row) {
      await ctx.db.insert("track", {
        opportunityId: args.opportunityId,
        deviceId: args.entrepreneurKey,
        ticked: [args.step],
        status: "applying",
        updatedAt: Date.now(),
      });
      await audit(ctx, grant._id, adviserKey, "ticked", `Step ${args.step} on ${opp.title}`);
      return [args.step];
    }
    const set = new Set(row.ticked);
    if (set.has(args.step)) set.delete(args.step);
    else set.add(args.step);
    const ticked = [...set];
    await ctx.db.patch("track", row._id, {
      ticked,
      status: ticked.length > 0 ? "applying" : "qualifying",
      updatedAt: Date.now(),
    });
    await audit(ctx, grant._id, adviserKey, "ticked", `Step ${args.step} on ${opp.title}`);
    return ticked;
  },
});

export const adviserSetPlanState = mutation({
  args: {
    entrepreneurKey: v.string(),
    opportunityId: v.id("opportunities"),
    state: v.union(
      v.literal("qualifying"),
      v.literal("ready"),
      v.literal("applying"),
      v.literal("applied"),
      v.literal("abandoned"),
    ),
    abandonReason: v.optional(v.string()),
  },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const adviserKey = await requireAccountKey(ctx);
    const grant = await requireGrant(ctx, args.entrepreneurKey, adviserKey, "plan:update", args.opportunityId);
    if (args.state === "abandoned" && !args.abandonReason?.trim()) {
      throw new Error("Abandoning needs a one-line reason.");
    }
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    const rows = await ctx.db
      .query("track")
      .withIndex("by_device", (q) => q.eq("deviceId", args.entrepreneurKey))
      .take(50);
    const row = rows.find((r) => r.opportunityId === args.opportunityId);
    const current = row ? displayPlanState(row.status) : "qualifying";
    if (current !== args.state && !(PLAN_TRANSITIONS[current] ?? []).includes(args.state)) {
      throw new Error(`Cannot move from ${current} to ${args.state}.`);
    }
    if (!row) {
      if (args.state === "applied" || args.state === "abandoned") {
        throw new Error(`Save this opportunity before marking it ${args.state}.`);
      }
      await ctx.db.insert("track", {
        opportunityId: args.opportunityId,
        deviceId: args.entrepreneurKey,
        ticked: [],
        status: args.state,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch("track", row._id, {
        status: args.state,
        abandonReason: args.state === "abandoned" ? args.abandonReason?.trim() : undefined,
        updatedAt: Date.now(),
      });
    }
    await audit(ctx, grant._id, adviserKey, "plan-state", `${current} → ${args.state} on ${opp.title}`);
    return true as const;
  },
});

export const adviserAnswer = mutation({
  args: {
    entrepreneurKey: v.string(),
    opportunityId: v.id("opportunities"),
    profileField: v.string(),
    value: v.string(),
    valueType: v.union(v.literal("string"), v.literal("number"), v.literal("boolean")),
  },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    const adviserKey = await requireAccountKey(ctx);
    const grant = await requireGrant(ctx, args.entrepreneurKey, adviserKey, "answers:confirm", args.opportunityId);
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    // Adviser answers land as opportunity-scoped overrides: the
    // entrepreneur's confirmed global facts are never silently replaced.
    const existing = await ctx.db
      .query("answerOverrides")
      .withIndex("by_owner_opportunity", (q) =>
        q.eq("ownerKey", args.entrepreneurKey).eq("opportunityId", args.opportunityId),
      )
      .take(20);
    const hit = existing.find((r) => r.profileField === args.profileField);
    if (hit) {
      await ctx.db.patch("answerOverrides", hit._id, {
        value: args.value,
        valueType: args.valueType,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("answerOverrides", {
        ownerKey: args.entrepreneurKey,
        opportunityId: args.opportunityId,
        profileField: args.profileField,
        value: args.value,
        valueType: args.valueType,
        updatedAt: Date.now(),
      });
    }
    await audit(ctx, grant._id, adviserKey, "answered", `${args.profileField}=${args.value} on ${opp.title}`);
    return true as const;
  },
});

export const adviserDocuments = query({
  args: { entrepreneurKey: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("userDocuments"),
      fileName: v.string(),
      docType: v.string(),
      state: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const adviserKey = await requireAccountKey(ctx);
    await requireGrant(ctx, args.entrepreneurKey, adviserKey, "documents:view");
    const docs = await ctx.db
      .query("userDocuments")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.entrepreneurKey))
      .take(50);
    const now = Date.now();
    return docs.map((d) => ({
      _id: d._id,
      fileName: d.fileName,
      docType: d.docType,
      state:
        d.expiresAt !== undefined && d.expiresAt < now
          ? "expired"
          : d.verification === "accepted"
            ? "accepted"
            : "present-unverified",
      updatedAt: d.updatedAt,
    }));
  },
});
