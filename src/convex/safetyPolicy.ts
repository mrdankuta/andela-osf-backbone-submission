// Assistant safety policy (issue #47).
//
// Messages are screened before generation (user prompts) and after
// generation (assistant replies) with explicit, inspectable code rules.
// Every rule maps to an action: pass, review (answer narrowly from verified
// details), block, or support (crisis path). Thresholds differ by
// consequence: fraud, wrongdoing, and instruction override always block;
// sensitive-data handling warns; only genuinely ambiguous phrasing routes
// to review. Ordinary funding questions always pass.

export type SafetyCategory =
  | "clean"
  | "instruction-override"
  | "harmful-illegal"
  | "sensitive-data"
  | "crisis";

export type SafetyAction = "pass" | "review" | "block" | "support";

export interface SafetyVerdict {
  category: Exclude<SafetyCategory, "clean"> | "clean";
  action: SafetyAction;
  matched: string[];
}

const INSTRUCTION_OVERRIDE_RES = [
  /ignore\s+(all\s+|any\s+)?(previous|above|prior)\s+(instructions?|prompts?)/i,
  /disregard\s+.*(instructions?|rules?)/i,
  /you\s+are\s+(now|no\s+longer)\b/i,
  /system\s*:/i,
  /\[inst\]/i,
  /developer\s+mode|jailbreak/i,
  /do\s+not\s+(tell|mention|reveal)\b/i,
  /\bpretend\s+(you|to\s+be)\b/i,
];

const HARMFUL_ILLEGAL_RES = [
  /how\s+to\s+(forge|fake|falsify|fabricate)\b/i,
  /\bfake\s+(a|an|the)?\s*(cac|certificate|document|bank\s+statement|id\b|passport|bvn|nin)\b/i,
  /\bforg(e|ing|ery|ed)\b/i,
  /\b(bribe|bribery|kickback)\b/i,
  /launder(\w*\s+money|ing)?\b/i,
  /defraud|scam\s+(someone|people|them)|steal\s+(from|money)/i,
  /fake\s+(bvn|nin|identity)/i,
  /how\s+to\s+(cheat|lie\s+on)\b.*(application|form|bank|eligibility)/i,
  /make\s+.*\blook\s+(eligible|registered)\b.*(when|although|even though).*(not|n't|never)/i,
];

const SENSITIVE_DATA_RES = [
  /\bbvn\b/i,
  /\bnin\b/i,
  /\bbank\s+(password|pin|otp|token)\b/i,
  /\bcard\s+(pin|number|cvv)\b/i,
  /my\s+(password|pin|otp)\s+is\b/i,
  /here\s+is\s+my\b/i,
  /share\s+my\s+(bank|account|card)\b/i,
  /what\s+is\s+my\b.*(bvn|nin|password|pin)/i,
];

const CRISIS_RES = [
  /kill\s+m(yself|e)\b/i,
  /suicid(e|al)\b/i,
  /end\s+my\s+life\b/i,
  /self[\s-]?harm\b/i,
  /hurt\s+(myself|yourself)\b/i,
  /you\s+should\s+(hurt|kill)\s+yourself/i,
  /kill\s+yourself\b/i,
  /don'?t\s+want\s+to\s+(live|be\s+alive|exist)\b/i,
  /better\s+off\s+dead\b/i,
];

const REVIEW_CUES_RES = [
  /\bguarantee(d)?\s+(approval|funding|loan|grant)\b/i,
  /approve\s+(me|my\s+business|everyone)\b/i,
  /just\s+say\s+(yes|i'?m\s+eligible)\b/i,
  /between\s+us\b/i,
  /off\s+the\s+record\b/i,
];

function hits(text: string, patterns: RegExp[]): string[] {
  return patterns.filter((re) => re.test(text)).map((re) => re.source.slice(0, 48));
}

/** Screen a message. Order matters: crisis first, then blocks, then review. */
export function screenMessage(text: string): SafetyVerdict {
  const normalized = text ?? "";
  const crisis = hits(normalized, CRISIS_RES);
  if (crisis.length > 0) {
    return { category: "crisis", action: "support", matched: crisis };
  }
  const harmful = hits(normalized, HARMFUL_ILLEGAL_RES);
  if (harmful.length > 0) {
    return { category: "harmful-illegal", action: "block", matched: harmful };
  }
  const override = hits(normalized, INSTRUCTION_OVERRIDE_RES);
  if (override.length > 0) {
    return { category: "instruction-override", action: "block", matched: override };
  }
  const sensitive = hits(normalized, SENSITIVE_DATA_RES);
  if (sensitive.length > 0) {
    return { category: "sensitive-data", action: "block", matched: sensitive };
  }
  const review = hits(normalized, REVIEW_CUES_RES);
  if (review.length > 0) {
    return { category: "harmful-illegal", action: "review", matched: review };
  }
  return { category: "clean", action: "pass", matched: [] };
}

export const SAFETY_RESPONSES: Record<Exclude<SafetyAction, "pass" | "review">, string> = {
  block:
    "I can't help with that. I can help with verified funding opportunities, eligibility checks, application steps, and deadlines instead.",
  support:
    "I'm really glad you told me. If you may act on these thoughts, please reach out right now to someone you trust, a local counselor, or your nearest hospital. You matter, and support is available. When you're ready, I can help with funding questions — one step at a time.",
};

export function reviewInstruction(): string {
  return "The request was flagged as borderline: answer ONLY from verified opportunity details, decline anything outside them, and keep it brief.";
}

/** Screen a generated assistant reply before display. User messages are
 *  never passed here — the input gate handled them at send time. */
export function screenOutput(text: string): { text: string; blocked: boolean } {
  if (!text) return { text, blocked: false };
  const verdict = screenMessage(text);
  if (verdict.action === "block" || verdict.action === "support") {
    return { text: SAFETY_RESPONSES[verdict.action], blocked: true };
  }
  return { text, blocked: false };
}
