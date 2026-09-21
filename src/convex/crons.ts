import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const expirePastDeadlines = internalMutation({
  args: {},
  returns: v.object({ expired: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db.query("opportunities").withIndex("by_status", (q) => q.eq("status", "verified")).take(100);
    let expired = 0;
    for (const o of open) {
      if (o.deadline !== undefined && o.deadline < now) {
        await ctx.db.patch("opportunities", o._id, { status: "expired" });
        expired++;
      }
    }
    return { expired };
  },
});

const crons = cronJobs();
crons.interval("expire past deadlines daily", { hours: 24 }, internal.crons.expirePastDeadlines, {});
crons.interval("check published sources daily", { hours: 24 }, internal.sourceMonitor.checkPublishedSources, {});
crons.interval("send readiness plan updates daily", { hours: 24 }, internal.planUpdates.sendDuePlanUpdates, {});

export default crons;
