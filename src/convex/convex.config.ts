import { defineApp } from "convex/server";
import { v } from "convex/values";
import betterAuth from "@convex-dev/better-auth/convex.config";
import resend from "@convex-dev/resend/convex.config";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp({ env: { OPENROUTER_API_KEY: v.optional(v.string()) } });
app.use(betterAuth);
app.use(resend);
app.use(agent);

export default app;