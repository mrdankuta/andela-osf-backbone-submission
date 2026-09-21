export const PROFILE_FIELDS = [
  "state",
  "sector",
  "businessStage",
  "cac",
  "staffSize",
  "age",
  "womenLed",
  "grant",
  "loan",
  "accelerator",
  "fellowship",
  "gov-program",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ChoiceJudgment = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ProfileProbability = { label: string; probability: number };
export type ProfileProposal = {
  field: ProfileField;
  value: string;
  confidence: number;
  probabilities: ProfileProbability[];
};
export type ProfileInterpretation = {
  source: "typesafe" | "fallback";
  proposals: ProfileProposal[];
};
export type ProfileJudgments = Partial<
  Record<Exclude<ProfileField, "staffSize">, ChoiceJudgment>
>;

export const FIELD_OPTIONS: Record<ProfileField, readonly string[]> = {
  state: ["Lagos", "Abuja FCT", "Kano", "Rivers", "Oyo", "Kaduna", "Abia", "Ogun", "Kwara", "Gombe", "Other", "unknown"],
  sector: ["Fashion", "Food", "Tech", "Beauty", "Agro", "Other", "unknown"],
  businessStage: ["Starting", "Growing", "Scaling", "unknown"],
  cac: ["Registered", "In Progress", "Not yet", "unknown"],
  staffSize: ["unknown"],
  age: ["18–24", "25–35", "35+", "unknown"],
  womenLed: ["Yes", "No", "unknown"],
  grant: ["Yes", "No", "unknown"],
  loan: ["Yes", "No", "unknown"],
  accelerator: ["Yes", "No", "unknown"],
  fellowship: ["Yes", "No", "unknown"],
  "gov-program": ["Yes", "No", "unknown"],
};

const NEED_FIELDS: ReadonlySet<ProfileField> = new Set([
  "grant",
  "loan",
  "accelerator",
  "fellowship",
  "gov-program",
]);

const WOMEN_EVIDENCE =
  /\b(?:women|woman|female)[- ](?:owned|led)\b|\b(?:owned|led)\s+by\s+(?:a\s+)?(?:women|woman|female)\b/i;
const WOMEN_NEGATED =
  /\bnot\s+(?:a\s+)?(?:women|woman|female)[- ](?:owned|led)\b|\bnot\s+(?:owned|led)\s+by\s+(?:a\s+)?(?:women|woman|female)\b/i;

function unknownProposal(field: ProfileField, confidence = 0): ProfileProposal {
  return { field, value: "unknown", confidence, probabilities: [{ label: "unknown", probability: 1 }] };
}

function knownProposal(field: ProfileField, value: string): ProfileProposal {
  return { field, value, confidence: 1, probabilities: [{ label: value, probability: 1 }] };
}

function detectStaffSize(text: string): ProfileProposal {
  const patterns = [
    /\bteam of (\d{1,4})\b/i,
    /\b(\d{1,4})\s*(?:staff|employees?|workers?|people)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n) && n >= 0 && n <= 500) return knownProposal("staffSize", String(n));
      return unknownProposal("staffSize");
    }
  }
  return unknownProposal("staffSize");
}

const PERSON_AGE =
  "(?:i am|i['’]m|my age is|(?:the\\s+)?(?:owner|founder)\\s+(?:is|aged|age(?:\\s+is)?))";

function detectAge(text: string): string | null {
  const fill = "\\s+(?:a\\s+|about\\s+|in the\\s+|of\\s+)?";
  if (new RegExp(`\\b${PERSON_AGE}${fill}18\\s*[-–—]\\s*24\\b`, "i").test(text)) return "18–24";
  if (new RegExp(`\\b${PERSON_AGE}${fill}25\\s*[-–—]\\s*35\\b`, "i").test(text)) return "25–35";
  if (new RegExp(`\\b${PERSON_AGE}${fill}35\\s*\\+`, "i").test(text)) return "35+";
  const m = text.match(
    new RegExp(`\\b${PERSON_AGE}${fill}(\\d{1,3})\\s*(?:years?\\s*old|yrs?\\s*old)?\\b`, "i"),
  );
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (n >= 18 && n <= 24) return "18–24";
  if (n >= 25 && n <= 35) return "25–35";
  if (n > 35 && n <= 120) return "35+";
  return null;
}

function fallbackValue(field: Exclude<ProfileField, "staffSize">, text: string): string {
  switch (field) {
    case "state":
      if (/\blagos\b/i.test(text)) return "Lagos";
      if (/\babuja\b|\bfct\b|federal capital/i.test(text)) return "Abuja FCT";
      if (/\bkano\b/i.test(text)) return "Kano";
      if (/\brivers\b|port harcourt/i.test(text)) return "Rivers";
      if (/\boyo\b|ibadan/i.test(text)) return "Oyo";
      if (/\bkaduna\b/i.test(text)) return "Kaduna";
      if (/\babia\b|aba\b|umuahia/i.test(text)) return "Abia";
      if (/\bogun\b|abeokuta/i.test(text)) return "Ogun";
      if (/\bkwara\b|ilorin/i.test(text)) return "Kwara";
      if (/\bgombe\b/i.test(text)) return "Gombe";
      return "unknown";
    case "sector":
      if (/fashion|cloth|tailor/i.test(text)) return "Fashion";
      if (/food|catering|restaurant|cook/i.test(text)) return "Food";
      if (/tech|software|digital/i.test(text)) return "Tech";
      if (/beauty|salon|cosmetic/i.test(text)) return "Beauty";
      if (/agro|farm|agricultur/i.test(text)) return "Agro";
      return "unknown";
    case "businessStage":
      if (/pre[- ]?revenue|\bidea\b|just starting|\bstarting\b/i.test(text)) return "Starting";
      if (/scaling|multiple locations/i.test(text)) return "Scaling";
      if (/growing|expanding/i.test(text)) return "Growing";
      return "unknown";
    case "cac":
      if (/not\s+(?:yet\s+)?registered|no\s+cac|unregistered|not\s+incorporated/i.test(text))
        return "Not yet";
      if (/\bcac\b[^.]{0,40}\bin\s*progress\b|\bin\s*progress\b[^.]{0,40}\bcac\b/i.test(text))
        return "In Progress";
      if (/\bcac\b[^.]{0,25}\bregistered\b|\bregistered\b[^.]{0,25}\bcac\b|\bincorporated\b/i.test(text))
        return "Registered";
      return "unknown";
    case "age":
      return detectAge(text) ?? "unknown";
    case "womenLed":
      if (WOMEN_NEGATED.test(text)) return "No";
      if (WOMEN_EVIDENCE.test(text)) return "Yes";
      return "unknown";
    case "grant":
      return detectNeed(text, /\bgrants?\b/i);
    case "loan":
      return detectNeed(text, /\bloans?\b/i);
    case "accelerator":
      return detectNeed(text, /\baccelerators?\b/i);
    case "fellowship":
      return detectNeed(text, /\bfellowships?\b/i);
    case "gov-program":
      return detectNeed(
        text,
        /\b(?:government|gov)[-\s]?program(?:me)?s?\b|\bgovernment schemes?\b/i,
      );
  }
}

const NEED_INTENT =
  "(?:needs?|wants?|seek(?:s|ing)?|looking\\s+for|interested\\s+in|apply(?:ing)?\\s+for|ask(?:s|ing)?\\s+for|hoping\\s+for|searching\\s+for)";
const NEED_NEGATED =
  "(?:don'?t|do\\s+not|doesn'?t|does\\s+not|didn'?t|did\\s+not|no\\s+longer|not|never)";
const NEED_INTENT_RE = new RegExp(
  `(${NEED_NEGATED}\\s*(?:\\w+\\s+){0,2}${NEED_INTENT})|(${NEED_INTENT})`,
  "gi",
);

function detectNeed(text: string, keyword: RegExp): "Yes" | "No" | "unknown" {
  let result: "Yes" | "No" | "unknown" = "unknown";
  for (const clause of text.split(/[.;!?\n]+/)) {
    const kw = clause.match(keyword);
    if (!kw || kw.index === undefined) continue;
    const before = clause.slice(0, kw.index);
    let last: { neg: boolean; end: number } | null = null;
    for (const m of before.matchAll(NEED_INTENT_RE)) {
      last = { neg: m[1] !== undefined, end: (m.index ?? 0) + m[0].length };
    }
    if (!last || kw.index - last.end > 40) continue;
    result = last.neg ? "No" : "Yes";
  }
  return result;
}

function isValidNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function normalizeJudgment(
  field: ProfileField,
  judgment: ChoiceJudgment | undefined,
  allowed: readonly string[],
): ProfileProposal {
  if (!judgment || typeof judgment.choice !== "string" || !allowed.includes(judgment.choice)) {
    return unknownProposal(field);
  }
  if (!isValidNumber(judgment.confidence)) return unknownProposal(field);
  const probs = judgment.probabilities;
  if (!probs || typeof probs !== "object") return unknownProposal(field);
  const labels = Object.keys(probs);
  if (labels.length !== allowed.length || !labels.every((l) => allowed.includes(l))) {
    return unknownProposal(field);
  }
  let sum = 0;
  for (const p of Object.values(probs)) {
    if (!isValidNumber(p)) return unknownProposal(field);
    sum += p;
  }
  if (Math.abs(sum - 1) > 0.01) return unknownProposal(field);
  return {
    field,
    value: judgment.choice,
    confidence: judgment.confidence,
    probabilities: allowed.map((label) => ({ label, probability: probs[label] })),
  };
}

function fallbackInterpretation(text: string, staff: ProfileProposal): ProfileInterpretation {
  return {
    source: "fallback",
    proposals: PROFILE_FIELDS.map((field) =>
      field === "staffSize" ? staff : knownProposal(field, fallbackValue(field, text)),
    ),
  };
}

export async function interpretProfileDescription(
  description: string,
  judge?: (description: string) => Promise<ProfileJudgments>,
): Promise<ProfileInterpretation> {
  const text = description.trim();
  if (text.length < 10)
    throw new Error("Description is too short — please write at least 10 characters.");
  if (text.length > 600)
    throw new Error("Description is too long — please keep it under 600 characters.");

  const staff = detectStaffSize(text);
  if (judge) {
    try {
      const judgments = await judge(text);
      const proposals = PROFILE_FIELDS.map((field) => {
        if (field === "staffSize") return staff;
        let p = normalizeJudgment(field, judgments[field], FIELD_OPTIONS[field]);
        if (NEED_FIELDS.has(field) && p.value !== "unknown") {
          const evidence = fallbackValue(field, text);
          if (evidence === "unknown") {
            p = { field, value: "unknown", confidence: 1, probabilities: [{ label: "unknown", probability: 1 }] };
          } else if (evidence !== p.value) {
            p = knownProposal(field, evidence);
          }
        }
        if (field === "womenLed" && p.value !== "unknown" && !WOMEN_EVIDENCE.test(text)) {
          p = { field, value: "unknown", confidence: 1, probabilities: [{ label: "unknown", probability: 1 }] };
        }
        if (field === "age" && p.value !== "unknown" && detectAge(text) === null) {
          p = { field, value: "unknown", confidence: 1, probabilities: [{ label: "unknown", probability: 1 }] };
        }
        return p;
      });
      return { source: "typesafe", proposals };
    } catch {
      return fallbackInterpretation(text, staff);
    }
  }
  return fallbackInterpretation(text, staff);
}
