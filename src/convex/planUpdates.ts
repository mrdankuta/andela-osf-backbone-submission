import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { Resend } from "@convex-dev/resend";
import { buildReadinessPlan } from "./opportunities";
import { readFreshness } from "./sourceMonitor";

// Concise readiness and deadline updates over a low-data channel (issue #52).
//
// Messages generate from the current readiness plan — never generic text —
// naming the opportunity, the next confirmed action or deadline risk, the
// freshness caveat, and a safe link. Sends happen on deadline cadence, on
// verdict transitions, or on first sighting; identical messages suppress
// within 72 hours. Failures record as failed without marking notified.

export const resend = new Resend(components.resend, { testMode: true });

export const UPDATE_SUPPRESS_HOURS = 72;
export const MAX_UPDATE_CHARS = 300;

export type UpdateContent = {
  subject: string;
  body: string;
  hash: string;
};

function shortTitle(title: string): string {
  return title.length <= 42 ? title : `${title.slice(0, 41)}…`;
}

/** Compose from the live plan. Deterministic and unit-tested. */
export function composePlanUpdate(args: {
  title: string;
  overall: string;
  gapLabel: string | null;
  actionTitle: string | null;
  daysAvailable: number | null;
  deadlineStatus: string;
  freshness: "ok" | "stale" | "unavailable" | "under-review" | "closed" | null;
  planLink: string | null;
}): UpdateContent {
  const parts: string[] = [];
  if (args.actionTitle) parts.push(`Next: ${args.actionTitle}.`);
  else if (args.gapLabel) parts.push(`Next: confirm ${args.gapLabel}.`);
  else if (args.overall === "ready") parts.push("You look ready — apply via the portal.");
  if (args.daysAvailable !== null) {
    parts.push(args.daysAvailable === 0 ? "Deadline is here." : `${args.daysAvailable}d left.`);
  } else if (args.deadlineStatus === "unknown") {
    parts.push("No deadline published.");
  }
  if (args.freshness && args.freshness !== "ok") {
    parts.push(args.freshness === "closed" ? "Now closed." : "Details unverified.");
  }
  let body = `${shortTitle(args.title)}: ${parts.join(" ")}`;
  if (args.planLink) body += ` ${args.planLink}`;
  if (body.length > MAX_UPDATE_CHARS) body = `${body.slice(0, MAX_UPDATE_CHARS - 1)}…`;
  return { subject: `Backbone: ${shortTitle(args.title)}`, body, hash: hashUpdate(body) };
}

export function hashUpdate(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function planLinkFor(opportunityId: string): string | null {
  const site = process.env.SITE_URL;
  if (site) return `${site.replace(/\/+$/, "")}/opportunity/${opportunityId}`;
  return null;
}

export const duePlanUpdates = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      ownerKey: v.string(),
      email: v.string(),
      opportunityId: v.id("opportunities"),
      title: v.string(),
      overall: v.string(),
      gapLabel: v.union(v.string(), v.null()),
      actionTitle: v.union(v.string(), v.null()),
      daysAvailable: v.union(v.number(), v.null()),
      deadlineStatus: v.string(),
      freshness: v.union(
        v.literal("ok"),
        v.literal("stale"),
        v.literal("unavailable"),
        v.literal("under-review"),
        v.literal("closed"),
        v.null(),
      ),
      reason: v.union(v.literal("cadence"), v.literal("transition"), v.literal("first")),
    }),
  ),
  handler: async (ctx) => {
    const tracks = await ctx.db.query("track").take(200);
    const out = [];
    for (const r of tracks) {
      if (r.status === "applied" || r.status === "abandoned") continue;
      const opp = await ctx.db.get("opportunities", r.opportunityId);
      if (!opp || opp.status !== "verified" || opp.catalogVisibility !== "public") continue;
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_owner", (q) => q.eq("ownerKey", r.deviceId))
        .unique();
      if (profile?.planUpdatesOptIn === false) continue;
      if (!profile?.email) continue;
      const facts = {
        state: profile?.state,
        sector: profile?.sector,
        businessStage: profile?.businessStage,
        cac: profile?.cac,
        staffSize: profile?.staffSize,
        age: profile?.age,
        womenLed: profile?.womenLed,
      };
      const asOf = Date.now();
      const plan = await buildReadinessPlan(ctx, r.opportunityId, { ...facts, asOf });
      if (!plan) continue;
      const freshness = await readFreshness(ctx, r.opportunityId);
      const sent = await ctx.db
        .query("planMessages")
        .withIndex("by_owner_opp", (q) => q.eq("ownerKey", r.deviceId).eq("opportunityId", r.opportunityId))
        .take(20);
      const lastSent = sent
        .filter((m) => m.status === "sent")
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const days = profile?.reminderDays ?? [7, 3, 1];
      const daysAvailable = plan.deadline.daysAvailable;
      const cadenceHit =
        daysAvailable !== null && days.some((d) => daysAvailable <= d && daysAvailable >= 0);
      const transitioned = !lastSent || lastSent.overall !== plan.overall;
      if (!cadenceHit && !transitioned) continue;
      out.push({
        ownerKey: r.deviceId,
        email: profile.email,
        opportunityId: r.opportunityId,
        title: opp.title,
        overall: plan.overall,
        gapLabel: plan.gap?.label ?? null,
        actionTitle: plan.action?.title ?? null,
        daysAvailable,
        deadlineStatus: plan.deadline.status,
        freshness: freshness?.state ?? null,
        reason: (!lastSent ? "first" : transitioned && !cadenceHit ? "transition" : "cadence") as
          | "cadence"
          | "transition"
          | "first",
      });
    }
    return out;
  },
});

export const sendDuePlanUpdates = internalMutation({
  args: {},
  returns: v.object({ checked: v.number(), sent: v.number(), suppressed: v.number(), failed: v.number() }),
  handler: async (ctx) => {
    const due: {
      ownerKey: string;
      email: string;
      opportunityId: string;
      title: string;
      overall: string;
      gapLabel: string | null;
      actionTitle: string | null;
      daysAvailable: number | null;
      deadlineStatus: string;
      freshness: "ok" | "stale" | "unavailable" | "under-review" | "closed" | null;
    }[] = await ctx.runQuery(internal.planUpdates.duePlanUpdates, {});
    const summary = { checked: due.length, sent: 0, suppressed: 0, failed: 0 };
    for (const row of due) {
      const content = composePlanUpdate({
        title: row.title,
        overall: row.overall,
        gapLabel: row.gapLabel,
        actionTitle: row.actionTitle,
        daysAvailable: row.daysAvailable,
        deadlineStatus: row.deadlineStatus,
        freshness: row.freshness,
        planLink: planLinkFor(row.opportunityId),
      });
      const recent = await ctx.db
        .query("planMessages")
        .withIndex("by_owner_opp", (q) =>
          q.eq("ownerKey", row.ownerKey).eq("opportunityId", row.opportunityId as never),
        )
        .take(20);
      const cutoff = Date.now() - UPDATE_SUPPRESS_HOURS * 3600000;
      // Only successful sends suppress: failures retry on the next run.
      if (recent.some((m) => m.status === "sent" && m.messageHash === content.hash && m.createdAt >= cutoff)) {
        summary.suppressed += 1;
        continue;
      }
      try {
        await resend.sendEmail(ctx, {
          from: "Backbone Africa <onboarding@resend.dev>",
          to: row.email,
          subject: content.subject,
          text: content.body,
        });
        await ctx.db.insert("planMessages", {
          ownerKey: row.ownerKey,
          opportunityId: row.opportunityId as never,
          messageHash: content.hash,
          channel: "email",
          status: "sent",
          overall: row.overall,
          createdAt: Date.now(),
        });
        summary.sent += 1;
      } catch (e) {
        // Recorded as failed: the user is NOT marked notified.
        await ctx.db.insert("planMessages", {
          ownerKey: row.ownerKey,
          opportunityId: row.opportunityId as never,
          messageHash: content.hash,
          channel: "email",
          status: "failed",
          overall: row.overall,
          error: e instanceof Error ? e.message : "send failed",
          createdAt: Date.now(),
        });
        summary.failed += 1;
      }
    }
    return summary;
  },
});
