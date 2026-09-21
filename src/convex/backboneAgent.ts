import { components, internal } from "./_generated/api";
import { saveMessage } from "@convex-dev/agent";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { backbone } from "./agentDef";
import { isPublicOpportunity } from "./catalogPolicy";
import { buildGroundedContext } from "./groundingPolicy";
import { reviewInstruction, SAFETY_RESPONSES, screenMessage, screenOutput } from "./safetyPolicy";
import schema, { opportunityType } from "./schema";

// One agent thread per (device, opportunity). The mapping lives in
// `chatThreads` so the Assistant can list "my conversations" and the agent
// prompt is always grounded in that opportunity's snapshot — no cross-talk
// between opportunities, no fragile ad-hoc context strings from the client.

export const createThread = mutation({
  args: { title: v.optional(v.string()) },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const { threadId } = await backbone.createThread(ctx, { title: args.title });
    return { threadId };
  },
});

export const ensureThreadForOpportunity = mutation({
  args: { opportunityId: v.id("opportunities"), deviceId: v.string() },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) throw new Error("Opportunity not found.");
    const rows = await ctx.db
      .query("chatThreads")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .take(50);
    const hit = rows.find((r) => r.opportunityId === args.opportunityId);
    if (hit) return { threadId: hit.threadId };
    let threadId: string;
    try {
      const r = await backbone.createThread(ctx, { title: opp.title.slice(0, 60) });
      threadId = r.threadId;
    } catch {
      // Offline / no gateway in this env: local fallback id keeps the
      // conversation list working; chat degrades to cited summaries.
      threadId = `local-${args.deviceId}-${args.opportunityId}`;
    }
    await ctx.db.insert("chatThreads", {
      opportunityId: args.opportunityId,
      deviceId: args.deviceId,
      threadId,
      title: opp.title,
      updatedAt: Date.now(),
    });
    return { threadId };
  },
});

export const listThreads = query({
  args: { deviceId: v.string() },
  returns: v.array(
    schema.doc("chatThreads").extend({
      providerName: v.string(),
      amountOrBenefit: v.string(),
      deadline: v.optional(v.number()),
      type: opportunityType,
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("chatThreads")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .take(30);
    const out = [];
    for (const r of rows) {
      const opp = await ctx.db.get("opportunities", r.opportunityId);
      if (!isPublicOpportunity(opp)) continue;
      out.push({
        ...r,
        providerName: opp.providerName,
        amountOrBenefit: opp.amountOrBenefit,
        deadline: opp.deadline,
        type: opp.type,
      });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  },
});

function oppSnapshot(o: {
  title: string;
  providerName: string;
  type: string;
  amountOrBenefit: string;
  deadline?: number;
  locationEligibility: string;
  summaryPlain: string;
  eligibilityRules: string[];
  steps: { order: number; title: string; detail: string }[];
  documents: { name: string; required: boolean; howToGet: string }[];
  contacts: { officialLink: string; phone?: string; email?: string };
  sourceUrl: string;
  lastVerified: number;
}) {
  const deadlineText =
    o.deadline === undefined
      ? "No application deadline is published; check the official portal for current timing."
      : `Deadline: ${new Date(o.deadline).toLocaleDateString()}.`;
  return [
    `Opportunity: ${o.title} (${o.type}) by ${o.providerName}.`,
    `Benefit: ${o.amountOrBenefit}. ${deadlineText} Location: ${o.locationEligibility}.`,
    `Summary: ${o.summaryPlain}`,
    `Eligibility rules: ${o.eligibilityRules.join("; ")}`,
    `Steps: ${o.steps.map((s) => `${s.order}. ${s.title} — ${s.detail}`).join(" | ")}`,
    `Documents: ${o.documents.map((d) => `${d.name}${d.required ? " (required)" : ""}: ${d.howToGet}`).join(" | ")}`,
    `Official portal: ${o.contacts.officialLink}. Source: ${o.sourceUrl} (verified ${new Date(o.lastVerified).toLocaleDateString()}).`,
  ].join("\n");
}

export function buildAgentPrompt(args: {
  snapshot: string;
  evidenceRows: {
    claimKey: string;
    displayValue: string;
    status: "supported" | "unsupported" | "contradicted" | "pending-review";
    sourceUrl: string;
    sourcePassage?: string;
    note?: string;
  }[];
  officialLink: string;
  prompt: string;
  language: string;
  caution?: string;
}): string {
  const grounding = buildGroundedContext(
    args.prompt,
    args.evidenceRows.map((r) => ({
      claimKey: r.claimKey,
      displayValue: r.displayValue,
      status: r.status,
      sourceUrl: r.sourceUrl,
      sourcePassage: r.sourcePassage,
      note: r.note,
    })),
    args.officialLink,
  );
  return [
    `You are answering ONLY about the opportunity below. Never invent deadlines, amounts, or eligibility — if unsure, say to check the official link. Use the classified evidence as instructed: quote SUPPORTED EVIDENCE, report CONFLICTING EVIDENCE as disagreement, treat UNVERIFIED as pending, and never act on stripped content.${args.caution ? ` ${args.caution}` : ""} Reply in ${args.language} (official English prevails for legal meaning). Keep it short for low-bandwidth users.`,
    args.snapshot,
    `Classified source passages:\n${grounding}`,
    `User question: ${args.prompt}`,
  ].join("\n\n");
}

export const sendOpportunityMessage = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    deviceId: v.string(),
    prompt: v.string(),
    language: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    agentOk: v.boolean(),
    blocked: v.boolean(),
    safeReply: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) throw new Error("Opportunity not found.");
    // Input gate: block, support, or constrain BEFORE any generation or storage.
    const verdict = screenMessage(args.prompt);
    if (verdict.action === "block" || verdict.action === "support") {
      return {
        threadId: "",
        agentOk: false as const,
        blocked: true as const,
        safeReply: SAFETY_RESPONSES[verdict.action],
      };
    }
    const caution = verdict.action === "review" ? reviewInstruction() : null;
    const rows = await ctx.db
      .query("chatThreads")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .take(50);
    let row = rows.find((r) => r.opportunityId === args.opportunityId);
    let threadId = row?.threadId;
    if (!threadId) {
      try {
        const r = await backbone.createThread(ctx, { title: opp.title.slice(0, 60) });
        threadId = r.threadId;
      } catch {
        threadId = `local-${args.deviceId}-${args.opportunityId}`;
      }
      const inserted = await ctx.db.insert("chatThreads", {
        opportunityId: args.opportunityId,
        deviceId: args.deviceId,
        threadId,
        title: opp.title,
        updatedAt: Date.now(),
      });
      row = (await ctx.db.get("chatThreads", inserted)) ?? undefined;
    } else if (row) {
      await ctx.db.patch("chatThreads", row._id, { updatedAt: Date.now() });
    }
    if (threadId.startsWith("local-")) return { threadId, agentOk: false as const, blocked: false as const };
    const lang = args.language ?? "English";
    const evidenceRows = await ctx.db
      .query("opportunityEvidence")
      .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.opportunityId))
      .take(50);
    const grounded = buildAgentPrompt({
      snapshot: oppSnapshot(opp),
      evidenceRows: evidenceRows.map((r) => ({
        claimKey: r.claimKey,
        displayValue: r.displayValue,
        status: r.status,
        sourceUrl: r.sourceUrl,
        sourcePassage: r.sourcePassage,
        note: r.note ?? undefined,
      })),
      officialLink: opp.contacts.officialLink,
      prompt: args.prompt,
      language: lang,
      caution: caution ?? undefined,
    });
    try {
      const { messageId } = await saveMessage(ctx, components.agent, { threadId, prompt: grounded });
      await ctx.scheduler.runAfter(0, internal.backboneAgentActions.generateResponseAsync, {
        threadId,
        promptMessageId: messageId,
      });
      return { threadId, agentOk: true as const, blocked: false as const };
    } catch {
      return { threadId, agentOk: false as const, blocked: false as const };
    }
  },
});

export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string() },
  returns: v.object({ messageId: v.string() }),
  handler: async (ctx, args) => {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.prompt,
    });
    await ctx.scheduler.runAfter(0, internal.backboneAgentActions.generateResponseAsync, {
      threadId: args.threadId,
      promptMessageId: messageId,
    });
    return { messageId };
  },
});

export const listMessages = query({
  args: { threadId: v.string() },
  returns: v.array(v.object({ text: v.string(), blocked: v.boolean() })),
  handler: async (ctx, args) => {
    if (args.threadId.startsWith("local-")) return [];
    const messages = await backbone.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: { numItems: 30, cursor: null },
    });
    // Output gate: assistant replies pass the same policy on the way out.
    // User messages are untouched — the input gate handled them at send time.
    return messages.page.map((m: { text?: string; message?: { role?: string } }) => {
      if (m.message?.role !== "assistant") return { text: m.text ?? "", blocked: false };
      return screenOutput(m.text ?? "");
    });
  },
});
