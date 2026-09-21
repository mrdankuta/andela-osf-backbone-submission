import { components } from "./_generated/api";
import { Resend } from "@convex-dev/resend";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { isPublicOpportunity } from "./catalogPolicy";

export const resend = new Resend(components.resend, { testMode: true });

function daysUntil(deadline: number) {
  return Math.ceil((deadline - Date.now()) / 86400000);
}

export const dueForDevice = query({
  args: { deviceId: v.string() },
  returns: v.array(
    v.object({
      opportunityId: v.id("opportunities"),
      title: v.string(),
      daysLeft: v.number(),
      nextStep: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const prof = await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerKey", args.deviceId)).unique();
    const days = prof?.reminderDays ?? [7, 3, 1];
    const rows = await ctx.db.query("track").withIndex("by_device", (q) => q.eq("deviceId", args.deviceId)).take(50);
    const due = [];
    for (const r of rows) {
      if (r.status === "applied") continue;
      const opp = await ctx.db.get("opportunities", r.opportunityId);
      if (!isPublicOpportunity(opp) || opp.deadline === undefined) continue;
      const left = daysUntil(opp.deadline);
      if (days.some((d) => left <= d && left >= 0)) {
        due.push({ opportunityId: r.opportunityId, title: opp.title, daysLeft: left, nextStep: opp.steps.find((s) => !r.ticked.includes(s.order))?.title ?? "All done" });
      }
    }
    return due;
  },
});

export const scanDue = internalQuery({
  args: {},
  returns: v.array(
    v.object({ deviceId: v.string(), title: v.string(), daysLeft: v.number() }),
  ),
  handler: async (ctx) => {
    const tracks = await ctx.db.query("track").take(200);
    const out: { deviceId: string; title: string; daysLeft: number }[] = [];
    for (const r of tracks) {
      if (r.status === "applied") continue;
      const opp = await ctx.db.get("opportunities", r.opportunityId);
      if (!isPublicOpportunity(opp) || opp.deadline === undefined) continue;
      const prof = await ctx.db.query("profiles").withIndex("by_owner", (q) => q.eq("ownerKey", r.deviceId)).unique();
      const days = prof?.reminderDays ?? [7, 3, 1];
      const left = daysUntil(opp.deadline);
      if (days.some((d) => left === d)) out.push({ deviceId: r.deviceId, title: opp.title, daysLeft: left });
    }
    return out;
  },
});

export const sendTestReminder = internalMutation({
  args: { to: v.string(), title: v.string(), daysLeft: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await resend.sendEmail(ctx, {
      from: "Backbone Africa <onboarding@resend.dev>",
      to: args.to,
      subject: `Reminder: ${args.title} closes in ${args.daysLeft}d`,
      html: `<p>${args.title} closes in ${args.daysLeft} days. Open Backbone Africa to finish your checklist.</p>`,
    });
    return true;
  },
});
