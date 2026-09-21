import { action, env, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import schema, { importDraftField, opportunityType } from "./schema";
import { requireCurator, reviewerIdentity } from "./curation";
import {
  buildFieldVerificationQuestions,
  buildFieldVerificationState,
  extractDraftFields,
  extractTitleFromHtml,
  stripHtml,
  verifyDraftFields,
  type DraftField,
  type ExtractedDraft,
} from "../lib/import-extractor";
import {
  classifySourceClause,
  type ClauseJudgment,
} from "./readinessPolicy";
import {
  OPENROUTER_DECISIONS_URL,
  OPENROUTER_JEV_MODEL,
} from "./profileInterpretation";

const IMPORT_TIMEOUT_MS = 15000;
const JEV_TIMEOUT_MS = 20000;
const JEV_VERIFY_THRESHOLD = 0.7;

const draftDoc = v.object({
  sourceUrl: v.string(),
  capturedAt: v.number(),
  captureStatus: v.union(v.literal("captured"), v.literal("failed")),
  captureError: v.optional(v.string()),
  snapshotText: v.optional(v.string()),
  title: importDraftField,
  benefit: importDraftField,
  deadline: importDraftField,
  deadlineAt: v.union(v.number(), v.null()),
  contacts: importDraftField,
  criteria: v.array(
    v.object({
      field: importDraftField,
      family: v.string(),
      role: v.string(),
    }),
  ),
  programStatus: importDraftField,
  applyDestination: importDraftField,
  reviewStatus: v.union(v.literal("needs-review"), v.literal("published"), v.literal("discarded")),
});

export type StoredCriterion = { field: DraftField; family: string; role: string };

/** Normalize pre-hierarchy draft rows (plain fields) to the classified
 *  shape, falling back to other/unclear rather than dropping history. */
export function normalizeCriterion(
  criterion: DraftField | StoredCriterion,
): StoredCriterion {
  if (
    criterion &&
    typeof criterion === "object" &&
    "field" in criterion &&
    criterion.field !== null &&
    typeof criterion.field === "object" &&
    "status" in (criterion.field as unknown as Record<string, unknown>)
  ) {
    return criterion as StoredCriterion;
  }
  return { field: criterion as DraftField, family: "other", role: "unclear" };
}

function emptyFields(): Omit<ExtractedDraft, "title" | "criteria"> & {
  title: DraftField;
  criteria: StoredCriterion[];
} {
  const unresolved = (): DraftField => ({ status: "unresolved", value: null, passage: null, confidence: 0 });
  return {
    title: unresolved(),
    benefit: unresolved(),
    deadline: unresolved(),
    contacts: unresolved(),
    criteria: [],
    programStatus: unresolved(),
    applyDestination: unresolved(),
  };
}

function deadlineAt(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(at) ? null : at;
}

export const SINGLE_DRAFT_FIELDS = [
  "title",
  "benefit",
  "deadline",
  "contacts",
  "programStatus",
  "applyDestination",
] as const;

export function draftFieldKeys(criteriaCount: number): string[] {
  return [
    ...SINGLE_DRAFT_FIELDS,
    ...Array.from({ length: criteriaCount }, (_, i) => `criterion:${i}`),
  ];
}

export const saveDraft = internalMutation({
  args: { draft: draftDoc },
  returns: v.id("importDrafts"),
  handler: async (ctx, args) => await ctx.db.insert("importDrafts", args.draft),
});

function parseFieldJudgments(
  data: unknown,
): Record<string, { choice: "supported" | "unsupported" | "uncertain"; confidence: number }> {
  const out: Record<string, { choice: "supported" | "unsupported" | "uncertain"; confidence: number }> = {};
  for (const [key, answer] of Object.entries(parseChoiceJudgments(data))) {
    if (!answer) continue;
    if (answer.choice !== "supported" && answer.choice !== "unsupported" && answer.choice !== "uncertain") {
      continue;
    }
    out[key] = { choice: answer.choice, confidence: answer.confidence };
  }
  return out;
}

async function judgeClause(
  questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>,
  state: Record<string, unknown>,
): Promise<Record<string, ClauseJudgment | undefined>> {
  const res = await fetch(OPENROUTER_DECISIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENROUTER_JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Clause classification failed with status ${res.status}`);
  return parseChoiceJudgments(await res.json());
}

function parseChoiceJudgments(data: unknown): Record<string, ClauseJudgment | undefined> {
  const out: Record<string, ClauseJudgment | undefined> = {};
  if (!data || typeof data !== "object") return out;
  const answers = (data as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") return out;
  for (const [key, raw] of Object.entries(answers as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const { type, choice, confidence } = raw as { type?: unknown; choice?: unknown; confidence?: unknown };
    if (type !== "choice" || typeof choice !== "string") continue;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    out[key] = { choice, confidence };
  }
  return out;
}

/** Classify each extracted criterion sentence; failures fall back to
 *  other/unclear rather than blocking the draft. */
async function classifyDraftCriteria(fields: DraftField[]): Promise<StoredCriterion[]> {
  const fallback = (field: DraftField): StoredCriterion => ({ field, family: "other", role: "unclear" });
  if (!env.OPENROUTER_API_KEY) return fields.map(fallback);
  return await Promise.all(
    fields.map(async (field) => {
      try {
        const cls = await classifySourceClause(field.value ?? field.passage ?? "", judgeClause);
        return { field, family: cls.family, role: cls.role };
      } catch {
        return fallback(field);
      }
    }),
  );
}

async function verifyWithJev(draft: ExtractedDraft): Promise<ExtractedDraft> {
  const questions = buildFieldVerificationQuestions(draft);
  if (Object.keys(questions).length === 0) return draft;
  const res = await fetch(OPENROUTER_DECISIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_JEV_MODEL,
      state: buildFieldVerificationState(draft),
      questions,
    }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Jev verification failed with status ${res.status}`);
  return verifyDraftFields(draft, parseFieldJudgments(await res.json()), JEV_VERIFY_THRESHOLD);
}

function toDocFields(draft: Omit<ExtractedDraft, "criteria">, criteria: StoredCriterion[]) {
  return {
    title: draft.title,
    benefit: draft.benefit,
    deadline: draft.deadline,
    deadlineAt: deadlineAt(draft.deadline.status === "proposed" ? draft.deadline.value : null),
    contacts: draft.contacts,
    criteria,
    programStatus: draft.programStatus,
    applyDestination: draft.applyDestination,
  };
}

function flatFields(draft: Omit<ExtractedDraft, "criteria">, criteria: StoredCriterion[]): DraftField[] {
  return [
    draft.title,
    draft.benefit,
    draft.deadline,
    draft.contacts,
    draft.programStatus,
    draft.applyDestination,
    ...criteria.map((c) => c.field),
  ];
}

function summarizeFields(fields: DraftField[]): { proposed: number; unresolved: number } {
  return {
    proposed: fields.filter((f) => f.status === "proposed").length,
    unresolved: fields.filter((f) => f.status !== "proposed").length,
  };
}

export const requestImport = action({
  args: { sourceUrl: v.string() },
  returns: v.union(
    v.object({
      draftId: v.id("importDrafts"),
      captureStatus: v.literal("captured"),
      proposed: v.number(),
      unresolved: v.number(),
    }),
    v.object({
      draftId: v.id("importDrafts"),
      captureStatus: v.literal("failed"),
      error: v.string(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { draftId: Id<"importDrafts">; captureStatus: "captured"; proposed: number; unresolved: number }
    | { draftId: Id<"importDrafts">; captureStatus: "failed"; error: string }
  > => {
    let url: URL;
    try {
      url = new URL(args.sourceUrl);
    } catch {
      throw new Error("That URL is not valid. Paste the full official link, starting with https://.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http(s) opportunity links can be imported.");
    }
    const capturedAt = Date.now();
    const fail = async (error: string) => {
      const draftId: Id<"importDrafts"> = await ctx.runMutation(
        internal.importDrafts.saveDraft,
        {
          draft: {
            ...toDocFields(emptyFields(), []),
            sourceUrl: args.sourceUrl,
            capturedAt,
            captureStatus: "failed" as const,
            captureError: error,
            reviewStatus: "needs-review" as const,
            deadlineAt: null,
          },
        },
      );
      return { draftId, captureStatus: "failed" as const, error };
    };
    let res: Response;
    try {
      res = await fetch(args.sourceUrl, {
        headers: { "user-agent": "BackboneAfrica-curators/1.0" },
        signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
      });
    } catch {
      return await fail("Could not reach that page. Check the link or try again later.");
    }
    if (!res.ok) {
      return await fail(`The page returned HTTP ${res.status}. Confirm the link opens in a browser.`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (/pdf/i.test(contentType) || /\.pdf(\?|$)/i.test(url.pathname)) {
      return await fail("PDF capture is not supported yet — paste an HTML programme page.");
    }
    if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      return await fail(`Unsupported content type (${contentType.split(";")[0]}). Paste an HTML programme page.`);
    }
    const html = await res.text();
    const text = stripHtml(html);
    if (!text) {
      return await fail("The page had no readable text to extract. It may need JavaScript rendering.");
    }
    let draft = extractDraftFields(text, args.sourceUrl);
    draft = { ...draft, title: extractTitleFromHtml(html, text) };
    let classified: StoredCriterion[] = draft.criteria.map((field) => ({
      field,
      family: "other",
      role: "unclear",
    }));
    if (env.OPENROUTER_API_KEY) {
      try {
        draft = await verifyWithJev(draft);
        classified = await classifyDraftCriteria(draft.criteria);
      } catch (e) {
        console.log(`Jev cascade skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    const { title, benefit, deadline, contacts, programStatus, applyDestination } = draft;
    const summary = summarizeFields(flatFields({ title, benefit, deadline, contacts, programStatus, applyDestination }, classified));
    const draftId: Id<"importDrafts"> = await ctx.runMutation(
      internal.importDrafts.saveDraft,
      {
        draft: {
          ...toDocFields({ title, benefit, deadline, contacts, programStatus, applyDestination }, classified),
          sourceUrl: args.sourceUrl,
          capturedAt,
          captureStatus: "captured" as const,
          snapshotText: text,
          reviewStatus: "needs-review" as const,
        },
      },
    );
    return { draftId, captureStatus: "captured" as const, ...summary };
  },
});

export const getDraft = query({
  args: { draftId: v.id("importDrafts") },
  returns: v.union(schema.doc("importDrafts"), v.null()),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const draft = await ctx.db.get("importDrafts", args.draftId);
    if (!draft) return null;
    return { ...draft, criteria: draft.criteria.map(normalizeCriterion) };
  },
});

export const listDrafts = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("importDrafts"),
      sourceUrl: v.string(),
      capturedAt: v.number(),
      captureStatus: v.union(v.literal("captured"), v.literal("failed")),
      reviewStatus: v.union(v.literal("needs-review"), v.literal("published"), v.literal("discarded")),
      proposed: v.number(),
      unresolved: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireCurator(ctx);
    const rows = await ctx.db
      .query("importDrafts")
      .withIndex("by_reviewStatus", (q) => q.eq("reviewStatus", "needs-review"))
      .take(30);
    return rows.map((r) => {
      const fields = [
        r.title,
        r.benefit,
        r.deadline,
        r.contacts,
        r.programStatus,
        r.applyDestination,
        ...r.criteria.map((c) => normalizeCriterion(c).field),
      ];
      return {
        _id: r._id,
        sourceUrl: r.sourceUrl,
        capturedAt: r.capturedAt,
        captureStatus: r.captureStatus,
        reviewStatus: r.reviewStatus,
        proposed: fields.filter((f) => f.status === "proposed").length,
        unresolved: fields.filter((f) => f.status !== "proposed").length,
      };
    });
  },
});

export const decideField = mutation({
  args: {
    draftId: v.id("importDrafts"),
    fieldKey: v.string(),
    decision: v.union(v.literal("accept"), v.literal("correct"), v.literal("reject"), v.literal("ambiguous")),
    correctedValue: v.optional(v.string()),
  },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const draft = await ctx.db.get("importDrafts", args.draftId);
    if (!draft) throw new Error("Draft not found.");
    if (draft.reviewStatus !== "needs-review") throw new Error("This draft is already reviewed.");
    if (!draftFieldKeys(draft.criteria.length).includes(args.fieldKey)) {
      throw new Error(`Unknown draft field: ${args.fieldKey}.`);
    }
    if (args.decision === "correct" && !args.correctedValue?.trim()) {
      throw new Error("A correction needs the corrected text.");
    }
    const reviewer = await reviewerIdentity(ctx);
    const decisions = (draft.decisions ?? []).filter((d) => d.fieldKey !== args.fieldKey);
    decisions.push({
      fieldKey: args.fieldKey,
      decision: args.decision,
      correctedValue: args.decision === "correct" ? args.correctedValue?.trim() : undefined,
      reviewer,
      decidedAt: Date.now(),
    });
    await ctx.db.patch("importDrafts", args.draftId, { decisions });
    return true as const;
  },
});

const CRITICAL_EVIDENCE_CLAIM: Record<string, "benefit" | "deadline" | "contact" | "applicationStatus" | "officialDestination"> = {
  benefit: "benefit",
  deadline: "deadline",
  contacts: "contact",
  programStatus: "applicationStatus",
  applyDestination: "officialDestination",
};

type ReviewDecision = {
  fieldKey: string;
  decision: "accept" | "correct" | "reject" | "ambiguous";
  correctedValue?: string;
};

type DraftRow = {
  sourceUrl: string;
  snapshotText?: string;
  title: DraftField;
  benefit: DraftField;
  deadline: DraftField;
  deadlineAt: number | null;
  contacts: DraftField;
  criteria: StoredCriterion[];
  programStatus: DraftField;
  applyDestination: DraftField;
  decisions?: ReviewDecision[];
};

function resolvedFieldValue(field: DraftField, decision: ReviewDecision): string | null {
  if (decision.decision === "accept") return field.value;
  if (decision.decision === "correct") return decision.correctedValue ?? null;
  return null;
}

function fieldByKey(draft: DraftRow, key: string): DraftField | null {
  if (key.startsWith("criterion:")) {
    const i = Number(key.slice("criterion:".length));
    return draft.criteria[i]?.field ?? null;
  }
  const single = (draft as unknown as Record<string, DraftField>)[key];
  return single ?? null;
}

export const publishDraft = mutation({
  args: {
    draftId: v.id("importDrafts"),
    providerName: v.string(),
    providerType: v.string(),
    type: opportunityType,
  },
  returns: v.object({
    opportunityId: v.id("opportunities"),
    status: v.union(v.literal("verified"), v.literal("unverified")),
    gaps: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const stored = await ctx.db.get("importDrafts", args.draftId);
    if (!stored) throw new Error("Draft not found.");
    if (stored.reviewStatus !== "needs-review") throw new Error("This draft is already reviewed.");
    if (!args.providerName.trim() || !args.providerType.trim()) {
      throw new Error("Provider name and type are required to publish.");
    }
    const draft = { ...(stored as unknown as DraftRow), criteria: stored.criteria.map(normalizeCriterion) };
    const keys = draftFieldKeys(draft.criteria.length);
    const byKey = new Map((draft.decisions ?? []).map((d) => [d.fieldKey, d]));
    const missing = keys.filter((k) => !byKey.has(k));
    if (missing.length > 0) {
      throw new Error(`Review incomplete — undecided: ${missing.join(", ")}.`);
    }
    const titleDecision = byKey.get("title")!;
    const titleValue = resolvedFieldValue(draft.title, titleDecision);
    if (!titleValue) {
      throw new Error("An accepted title is required to publish — reject the draft instead.");
    }
    const gaps: string[] = [];
    const evidence: {
      claimType: "benefit" | "deadline" | "eligibility" | "contact" | "applicationStatus" | "officialDestination";
      claimKey: string;
      displayValue: string;
      sourcePassage: string;
      corrected: boolean;
    }[] = [];
    for (const key of ["benefit", "deadline", "contacts", "programStatus", "applyDestination"] as const) {
      const field = fieldByKey(draft, key)!;
      const value = resolvedFieldValue(field, byKey.get(key)!);
      const decision = byKey.get(key)!;
      if ((decision.decision === "accept" || decision.decision === "correct") && value && field.passage) {
        evidence.push({
          claimType: CRITICAL_EVIDENCE_CLAIM[key],
          claimKey: key,
          displayValue: value,
          sourcePassage: field.passage,
          corrected: decision.decision === "correct",
        });
      } else {
        gaps.push(key);
      }
    }
    const rules: string[] = [];
    draft.criteria.forEach((c, i) => {
      const decision = byKey.get(`criterion:${i}`)!;
      const value = resolvedFieldValue(c.field, decision);
      if ((decision.decision === "accept" || decision.decision === "correct") && value && c.field.passage) {
        rules.push(value);
        evidence.push({
          claimType: "eligibility",
          claimKey: `criterion-${i}`,
          displayValue: value,
          sourcePassage: c.field.passage,
          corrected: decision.decision === "correct",
        });
      } else {
        gaps.push(`criterion:${i}`);
      }
    });
    const now = Date.now();
    const reviewer = await reviewerIdentity(ctx);
    const qualified = gaps.length === 0;
    const contactsValue = resolvedFieldValue(draft.contacts, byKey.get("contacts")!);
    const applyValue = resolvedFieldValue(draft.applyDestination, byKey.get("applyDestination")!);
    const applyUrl = applyValue?.startsWith("http") ? applyValue : undefined;
    const officialLink =
      contactsValue?.startsWith("http") ? contactsValue : applyUrl ?? draft.sourceUrl;
    let deadline: number | undefined;
    const deadlineDecision = byKey.get("deadline")!;
    const deadlineValue = resolvedFieldValue(draft.deadline, deadlineDecision);
    if (deadlineDecision.decision === "correct" && deadlineValue) {
      const at = Date.parse(deadlineValue);
      deadline = Number.isNaN(at) ? undefined : at;
    } else if (deadlineDecision.decision === "accept") {
      deadline = draft.deadlineAt ?? undefined;
    }
    const benefitValue = resolvedFieldValue(draft.benefit, byKey.get("benefit")!);
    const opportunityId = await ctx.db.insert("opportunities", {
      title: titleValue,
      providerName: args.providerName.trim(),
      providerType: args.providerType.trim(),
      type: args.type,
      amountOrBenefit: benefitValue ?? "See the official programme page.",
      deadline,
      deadlineNote: deadline === undefined ? "No application deadline was published on the captured page." : undefined,
      catalogVisibility: qualified ? ("public" as const) : ("hidden" as const),
      locationEligibility: "See the official programme page.",
      sectorTags: ["all"],
      summaryPlain: benefitValue ?? titleValue,
      eligibilityRules: rules,
      steps: [
        {
          order: 1,
          title: "Apply via the official portal",
          detail: "Follow the current application instructions on the official page.",
          link: applyUrl,
        },
      ],
      documents: [],
      contacts: { officialLink },
      sourceUrl: draft.sourceUrl,
      lastVerified: qualified ? now : 0,
      status: qualified ? ("verified" as const) : ("unverified" as const),
    });
    for (const e of evidence) {
      await ctx.db.insert("opportunityEvidence", {
        opportunityId,
        claimType: e.claimType,
        claimKey: e.claimKey,
        displayValue: e.displayValue,
        status: "supported",
        sourceUrl: draft.sourceUrl,
        sourcePassage: e.sourcePassage,
        note: e.corrected ? `Curator-corrected by ${reviewer}.` : undefined,
        checkedAt: now,
      });
    }
    await ctx.db.patch("importDrafts", args.draftId, {
      reviewStatus: "published",
      publishedOpportunityId: opportunityId,
      publishedBy: reviewer,
      publishedAt: now,
    });
    return { opportunityId, status: qualified ? ("verified" as const) : ("unverified" as const), gaps };
  },
});
