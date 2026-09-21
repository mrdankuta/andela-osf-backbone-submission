"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { backbone } from "./agentDef";

export const generateResponseAsync = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await backbone.generateText(ctx, { threadId: args.threadId }, { promptMessageId: args.promptMessageId });
    return null;
  },
});

export const askOnce = action({
  args: { prompt: v.string(), context: v.optional(v.string()) },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args) => {
    const full = args.context ? `${args.context}\n\nQuestion: ${args.prompt}` : args.prompt;
    const result = await backbone.generateText(ctx, {}, { prompt: full });
    return { text: result.text };
  },
});
