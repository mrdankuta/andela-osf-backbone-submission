import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { effectiveOwnerKey } from "./identity";
import { coerceFactValue, readAnswerProvenance, type ProvenanceEntry } from "./answerLedger";
import { loadReadiness } from "./opportunities";
import { documentState } from "./userDocuments";

// Application-response drafting from confirmed facts (issue #53).
//
// Drafts assemble from confirmed reusable answers (with provenance),
// curator-accepted documents, and cited opportunity sources only.
// Anything unconfirmed renders as an explicit [NEEDS …] gap — never
// generated detail. The entrepreneur edits, rejects, or approves;
// approving changes the draft row, never the underlying facts.

export const DRAFT_QUESTIONS = ["business-summary", "eligibility-statement", "document-cover"] as const;

const questionKey = v.union(
  v.literal("business-summary"),
  v.literal("eligibility-statement"),
  v.literal("document-cover"),
);

type FactMap = Record<string, string | number | boolean | undefined>;

function traceFor(field: string, provenance: ProvenanceEntry[]): string {
  const overridden = provenance.find((p) => p.field === field && p.overridden);
  if (overridden) {
    const base = provenance.find((p) => p.field === field && !p.overridden);
    return (
      `answer:${field} (this opportunity: ${overridden.displayValue}` +
      (base ? `; saved answer differs: ${base.displayValue} from ${base.sourceLabel}` : "") +
      `)`
    );
  }
  const entry = provenance.find((p) => p.field === field && !p.overridden);
  return entry ? `answer:${field} (${entry.sourceLabel})` : `answer:${field} (unconfirmed)`;
}

function gapMarker(label: string): string {
  return `[NEEDS: ${label}]`;
}

async function assembleDraft(
  ctx: QueryCtx,
  opportunityId: Id<"opportunities">,
  ownerKey: string,
  question: (typeof DRAFT_QUESTIONS)[number],
): Promise<{ text: string; traces: { statement: string; source: string }[]; gaps: string[] }> {
  const opp = await ctx.db.get("opportunities", opportunityId);
  if (!opp) throw new Error("Opportunity not found.");
  const provenance = await readAnswerProvenance(ctx, ownerKey, opportunityId);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
    .unique();
  const overrides = await ctx.db
    .query("answerOverrides")
    .withIndex("by_owner_opportunity", (q) => q.eq("ownerKey", ownerKey).eq("opportunityId", opportunityId))
    .take(20);
  const facts: FactMap = {
    state: profile?.state,
    sector: profile?.sector,
    businessStage: profile?.businessStage,
    cac: profile?.cac,
    staffSize: profile?.staffSize,
    age: profile?.age,
    womenLed: profile?.womenLed,
  };
  for (const o of overrides) facts[o.profileField] = coerceFactValue(o.value, o.valueType);
  const docs = await ctx.db
    .query("userDocuments")
    .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
    .take(50);
  const traces: { statement: string; source: string }[] = [];
  const gaps: string[] = [];
  const lines: string[] = [];

  if (question === "business-summary") {
    const sector = facts.sector ? String(facts.sector) : null;
    const state = facts.state ? String(facts.state) : null;
    lines.push(
      `I run a ${sector ?? gapMarker("business sector")} business${state ? ` in ${state}` : ` ${gapMarker("operating state")}`}.`,
    );
    traces.push({
      statement: lines[lines.length - 1],
      source: [sector ? traceFor("sector", provenance) : null, state ? traceFor("state", provenance) : null]
        .filter(Boolean)
        .join("; "),
    });
    if (!sector) gaps.push("business sector");
    if (!state) gaps.push("operating state");
    if (facts.businessStage !== undefined) {
      lines.push(`The business is at ${String(facts.businessStage).toLowerCase()} stage.`);
      traces.push({ statement: lines[lines.length - 1], source: traceFor("businessStage", provenance) });
    }
    if (facts.staffSize !== undefined) {
      lines.push(`We employ ${String(facts.staffSize)} people full-time.`);
      traces.push({ statement: lines[lines.length - 1], source: traceFor("staffSize", provenance) });
    }
    if (facts.womenLed !== undefined) {
      const led = facts.womenLed === true;
      lines.push(led ? "The business is women-owned and women-led." : "The business is not women-led.");
      traces.push({ statement: lines[lines.length - 1], source: traceFor("womenLed", provenance) });
    } else {
      gaps.push("women-led status");
    }
    lines.push(`We are applying to ${opp.title} (${opp.providerName}).`);
    traces.push({ statement: lines[lines.length - 1], source: `source:${opp.sourceUrl}` });
  }

  if (question === "eligibility-statement") {
    const { assessments } = await loadReadiness(ctx, opportunityId, { ...facts, ownerKey });
    for (const a of assessments) {
      if (a.result === "met") {
        const value = a.profileValue ?? null;
        lines.push(`We meet “${a.label}”${value !== null ? `: ${String(value)}` : ""}.`);
        traces.push({
          statement: lines[lines.length - 1],
          source: value !== null ? traceFor(String(a.profileField), provenance) : `source:${opp.sourceUrl}`,
        });
      } else if (a.result === "unmet") {
        lines.push(`${gapMarker(`criterion unmet: ${a.label}`)}`);
        gaps.push(`criterion unmet: ${a.label}`);
        traces.push({ statement: lines[lines.length - 1], source: `assessment:${a.criterionKey} (${a.result})` });
      } else {
        lines.push(`${gapMarker(`${a.label}: ${a.result}`)}`);
        gaps.push(`${a.label}: ${a.result}`);
        traces.push({ statement: lines[lines.length - 1], source: `assessment:${a.criterionKey} (${a.result})` });
      }
    }
  }

  if (question === "document-cover") {
    const accepted = docs.filter((d) => documentState(d, Date.now()) === "accepted");
    if (accepted.length === 0) {
      lines.push(gapMarker("no accepted document on file"));
      gaps.push("no accepted document on file");
      traces.push({ statement: lines[lines.length - 1], source: "documents:none-accepted" });
    }
    for (const d of accepted) {
      lines.push(
        `Please find attached ${d.fileName} in support of our application to ${opp.title}.`,
      );
      traces.push({ statement: lines[lines.length - 1], source: `document:${d.docType} (accepted)` });
    }
    lines.push(`Programme source: ${opp.sourceUrl}.`);
    traces.push({ statement: lines[lines.length - 1], source: `source:${opp.sourceUrl}` });
  }

  return { text: lines.join("\n"), traces, gaps };
}

const draftValidator = schema.doc("applicationDrafts");

export const generateDraft = mutation({
  args: { ownerKey: v.string(), opportunityId: v.id("opportunities"), questionKey },
  returns: draftValidator,
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const { text, traces, gaps } = await assembleDraft(ctx, args.opportunityId, ownerKey, args.questionKey);
    const now = Date.now();
    const id = await ctx.db.insert("applicationDrafts", {
      ownerKey,
      opportunityId: args.opportunityId,
      questionKey: args.questionKey,
      generatedText: text,
      traces,
      gaps,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    const row = await ctx.db.get("applicationDrafts", id);
    if (!row) throw new Error("Draft not saved.");
    return row;
  },
});

export const listDrafts = query({
  args: { ownerKey: v.string(), opportunityId: v.optional(v.id("opportunities")) },
  returns: v.array(draftValidator),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const rows = args.opportunityId
      ? await ctx.db
          .query("applicationDrafts")
          .withIndex("by_owner_opportunity", (q) => q.eq("ownerKey", ownerKey).eq("opportunityId", args.opportunityId!))
          .take(20)
      : await ctx.db
          .query("applicationDrafts")
          .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
          .take(20);
    return rows;
  },
});

export const editDraft = mutation({
  args: { ownerKey: v.string(), draftId: v.id("applicationDrafts"), editedText: v.string() },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const row = await ctx.db.get("applicationDrafts", args.draftId);
    if (!row || row.ownerKey !== ownerKey) throw new Error("Draft not found.");
    if (row.status !== "draft") throw new Error("Only open drafts can be edited.");
    await ctx.db.patch("applicationDrafts", args.draftId, { editedText: args.editedText, updatedAt: Date.now() });
    return true as const;
  },
});

export const reviewDraft = mutation({
  args: { ownerKey: v.string(), draftId: v.id("applicationDrafts"), approved: v.boolean() },
  returns: v.object({ status: v.union(v.literal("approved"), v.literal("rejected")) }),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const row = await ctx.db.get("applicationDrafts", args.draftId);
    if (!row || row.ownerKey !== ownerKey) throw new Error("Draft not found.");
    // Approving records the entrepreneur's decision on the draft row only —
    // confirmed facts, documents, and evidence are never modified here.
    const status = args.approved ? ("approved" as const) : ("rejected" as const);
    await ctx.db.patch("applicationDrafts", args.draftId, { status, updatedAt: Date.now() });
    return { status };
  },
});
