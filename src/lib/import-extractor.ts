// Pure import-extraction helpers for the curator URL-import pipeline.
// Cheap heuristic extraction proposes draft fields from a captured source
// snapshot; a TypeSafe verification cascade (verifyDraftFields) can only
// demote uncertain or unsupported values to "unresolved" — never invent.

export type DraftFieldStatus = "proposed" | "unresolved";

export interface DraftField {
  status: DraftFieldStatus;
  value: string | null;
  passage: string | null;
  confidence: number;
}

export interface ExtractedDraft {
  title: DraftField;
  benefit: DraftField;
  deadline: DraftField;
  contacts: DraftField;
  criteria: DraftField[];
  programStatus: DraftField;
  applyDestination: DraftField;
}

export interface FieldJudgment {
  choice: "supported" | "unsupported" | "uncertain";
  confidence: number;
}

const MAX_SNAPSHOT_CHARS = 20000;
const MAX_CRITERIA = 8;

function unresolved(): DraftField {
  return { status: "unresolved", value: null, passage: null, confidence: 0 };
}

/** Strip tags/scripts/styles from captured HTML into plain text. */
export function stripHtml(html: string): string {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const noTags = noScripts.replace(/<[^>]*>/g, " ");
  return noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SNAPSHOT_CHARS);
}

/** Prefer the HTML <title>; fall back to the first text line. */
export function extractTitleFromHtml(html: string, text: string): DraftField {
  const m = html.match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
  const raw = (m?.[1] ?? text.split(/[.\n]/)[0] ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return unresolved();
  return { status: "proposed", value: raw.slice(0, 120), passage: raw.slice(0, 280), confidence: 0.5 };
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12);
}

const AMOUNT_RE = /(₦\s?[\d,.]+|NGN\s?[\d,.]+|naira|₦|US?\$ ?[\d,.]+|\b\d[\d,.]*\s?(million|billion)\b|\b(fund|funds|funding|grant|loan|financing|support|opportunit(ies|y)|mentorship|training)\b)/i;

export function extractBenefit(sentences: string[]): DraftField {
  const hit = sentences.find((s) => AMOUNT_RE.test(s));
  if (!hit) return unresolved();
  return { status: "proposed", value: hit.slice(0, 280), passage: hit.slice(0, 280), confidence: 0.6 };
}

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const DATE_RES = [
  /\b20\d{2}-\d{2}-\d{2}\b/,
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+20\\d{2}\\b`, "i"),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+20\\d{2}\\b`, "i"),
];

const MONTH_INDEX: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/** Normalize a matched date string to YYYY-MM-DD without timezone shifts. */
function findDates(sentence: string): string[] {
  const out: string[] = [];
  for (const re of DATE_RES) {
    const m = sentence.match(new RegExp(re.source, re.flags.includes("i") ? "gi" : "g"));
    if (m) out.push(...m);
  }
  return out;
}

function normalizeDateString(raw: string): string | null {
  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\s+(20\\d{2})\\b`, "i"));
  if (dmy) {
    const month = MONTH_INDEX[dmy[2].toLowerCase()];
    if (month) return `${dmy[3]}-${month}-${dmy[1].padStart(2, "0")}`;
  }
  const mdy = raw.match(new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, "i"));
  if (mdy) {
    const month = MONTH_INDEX[mdy[1].toLowerCase()];
    if (month) return `${mdy[3]}-${month}-${mdy[2].padStart(2, "0")}`;
  }
  return null;
}

/** Exact dates are selected from source candidates and normalized by code. */
export function extractDeadline(sentences: string[]): DraftField {
  const dated = sentences
    .filter((s) => /deadline|clos|due|ends?|expir|submit by|apply by|before/i.test(s))
    .flatMap((s) => findDates(s).map((d) => ({ date: d, passage: s })))
    .map((d) => ({ ...d, iso: normalizeDateString(d.date) }))
    .filter((d): d is { date: string; passage: string; iso: string } => d.iso !== null);
  const distinct = [...new Set(dated.map((d) => d.iso))];
  if (distinct.length !== 1) {
    if (dated.length === 0) return unresolved();
    return {
      status: "unresolved",
      value: null,
      passage: dated
        .map((d) => d.passage)
        .slice(0, 2)
        .join(" / ")
        .slice(0, 280),
      confidence: 0,
    };
  }
  const iso = distinct[0];
  const passage = dated.find((d) => d.iso === iso)?.passage ?? "";
  return { status: "proposed", value: iso, passage: passage.slice(0, 280), confidence: 0.65 };
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_RE = /(\+234[\s-]?\d[\d\s-]{6,13}\d|0\d{3}[\s-]?\d{3}[\s-]?\d{4})/;
const URL_RE = /https?:\/\/[^\s"'<>]+/g;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function extractContacts(sentences: string[], sourceUrl: string): DraftField {
  const sourceHost = hostOf(sourceUrl);
  const urls = [...new Set(sentences.flatMap((s) => s.match(URL_RE) ?? []))].map((u) =>
    u.replace(/[.,;!?)]+$/, ""),
  );
  const official = urls.find((u) => sourceHost !== null && hostOf(u) === sourceHost) ?? urls[0] ?? null;
  const email = sentences.map((s) => s.match(EMAIL_RE)?.[0]).find(Boolean) ?? null;
  const phone = sentences.map((s) => s.match(PHONE_RE)?.[0]).find(Boolean) ?? null;
  const value = official ?? [email, phone].filter(Boolean).join(" · ") ?? null;
  if (!value) return unresolved();
  const passage =
    sentences.find((s) => (official !== null && s.includes(official)) || (email !== null && s.includes(email))) ??
    sentences[0];
  return { status: "proposed", value, passage: passage.slice(0, 280), confidence: 0.6 };
}

const CRITERION_RE =
  /\b(must|requirement|requires?|required|eligib|qualif|who can|should be|aged?|women|cac|incorporat|register|resident|operate|turnover|employees?|revenue|sector|stage)\b/i;

export function extractCriteria(sentences: string[]): DraftField[] {
  return sentences
    .filter((s) => CRITERION_RE.test(s))
    .slice(0, MAX_CRITERIA)
    .map((s) => ({
      status: "proposed" as const,
      value: s.slice(0, 280),
      passage: s.slice(0, 280),
      confidence: 0.55,
    }));
}

export function extractProgramStatus(sentences: string[]): DraftField {
  const open = sentences.filter((s) => /\b(now open|applications? (are|is) open|ongoing|currently open)\b/i.test(s));
  const closed = sentences.filter((s) => /\b(closed|ended|expired|no longer accepting)\b/i.test(s));
  if (open.length > 0 && closed.length === 0) {
    return { status: "proposed", value: "Active", passage: open[0].slice(0, 280), confidence: 0.6 };
  }
  if (closed.length > 0 && open.length === 0) {
    return { status: "proposed", value: "Closed", passage: closed[0].slice(0, 280), confidence: 0.6 };
  }
  if (open.length > 0 || closed.length > 0) {
    return {
      status: "unresolved",
      value: null,
      passage: [...open, ...closed].slice(0, 2).join(" / ").slice(0, 280),
      confidence: 0,
    };
  }
  return unresolved();
}

export function extractApplyDestination(sentences: string[], sourceUrl: string): DraftField {
  const sourceHost = hostOf(sourceUrl);
  const applySentences = sentences.filter((s) => /\b(apply|application|portal|register|submit)\b/i.test(s));
  const urls = [...new Set(applySentences.flatMap((s) => s.match(URL_RE) ?? []))].map((u) =>
    u.replace(/[.,;!?)]+$/, ""),
  );
  const dest = urls.find((u) => sourceHost !== null && hostOf(u) === sourceHost) ?? urls[0] ?? null;
  if (!dest) return unresolved();
  const passage = applySentences.find((s) => s.includes(dest)) ?? applySentences[0] ?? "";
  return { status: "proposed", value: dest, passage: passage.slice(0, 280), confidence: 0.6 };
}

export function extractDraftFields(snapshotText: string, sourceUrl: string): ExtractedDraft {
  const sentences = splitSentences(snapshotText);
  return {
    title: unresolved(), // title needs the raw HTML; set separately via extractTitleFromHtml
    benefit: extractBenefit(sentences),
    deadline: extractDeadline(sentences),
    contacts: extractContacts(sentences, sourceUrl),
    criteria: extractCriteria(sentences),
    programStatus: extractProgramStatus(sentences),
    applyDestination: extractApplyDestination(sentences, sourceUrl),
  };
}

/** Verification cascade: a field stays proposed only when the judgment
 *  supports it at or above threshold; anything else becomes unresolved
 *  (value and passage are kept for the curator). */
export function verifyDraftFields(
  draft: ExtractedDraft,
  judgments: Record<string, FieldJudgment | undefined>,
  threshold = 0.7,
): ExtractedDraft {
  const gate = (key: string, field: DraftField): DraftField => {
    if (field.status !== "proposed") return field;
    const j = judgments[key];
    if (!j || j.choice !== "supported" || j.confidence < threshold) {
      return { ...field, status: "unresolved", confidence: 0 };
    }
    return field;
  };
  return {
    title: gate("title", draft.title),
    benefit: gate("benefit", draft.benefit),
    deadline: gate("deadline", draft.deadline),
    contacts: gate("contacts", draft.contacts),
    criteria: draft.criteria.map((c, i) => gate(`criterion:${i}`, c)),
    programStatus: gate("programStatus", draft.programStatus),
    applyDestination: gate("applyDestination", draft.applyDestination),
  };
}

/** Build one verification question per proposed field for the Jev cascade. */
export function buildFieldVerificationQuestions(draft: ExtractedDraft): Record<
  string,
  { type: "choice"; instructions: string; criteria: Record<string, string> }
> {
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
  const ask = (key: string, label: string, field: DraftField) => {
    if (field.status !== "proposed" || !field.value || !field.passage) return;
    questions[key] = {
      type: "choice",
      instructions: `Does \`passage\` directly state the proposed ${label} \`value\`? Use quoted wording only; do not infer.`,
      criteria: {
        supported: "The passage directly states the proposed value.",
        unsupported: "The passage conflicts with or does not state the proposed value.",
        uncertain: "It cannot be resolved from the wording.",
      },
    };
  };
  ask("title", "title", draft.title);
  ask("benefit", "benefit", draft.benefit);
  ask("deadline", "deadline date", draft.deadline);
  ask("contacts", "contact", draft.contacts);
  draft.criteria.forEach((c, i) => ask(`criterion:${i}`, "eligibility criterion", c));
  ask("programStatus", "programme status", draft.programStatus);
  ask("applyDestination", "application destination", draft.applyDestination);
  return questions;
}

/** State payload pairing each question with its field value and passage. */
export function buildFieldVerificationState(
  draft: ExtractedDraft,
): Record<string, { field: string; value: string; passage: string }> {
  const state: Record<string, { field: string; value: string; passage: string }> = {};
  const put = (key: string, label: string, field: DraftField) => {
    if (field.status !== "proposed" || !field.value || !field.passage) return;
    state[key] = { field: label, value: field.value, passage: field.passage };
  };
  put("title", "title", draft.title);
  put("benefit", "benefit", draft.benefit);
  put("deadline", "deadline date", draft.deadline);
  put("contacts", "contact", draft.contacts);
  draft.criteria.forEach((c, i) => put(`criterion:${i}`, "eligibility criterion", c));
  put("programStatus", "programme status", draft.programStatus);
  put("applyDestination", "application destination", draft.applyDestination);
  return state;
}
