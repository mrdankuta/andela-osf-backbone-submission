import { action, env } from "./_generated/server";
import { v } from "convex/values";
import {
  FIELD_OPTIONS,
  interpretProfileDescription,
  PROFILE_FIELDS,
  type ProfileJudgments,
} from "../lib/profile-interpreter";

const QUESTION_IDS = [
  "state",
  "sector",
  "businessStage",
  "cac",
  "age",
  "womenLed",
  "grant",
  "loan",
  "accelerator",
  "fellowship",
  "gov-program",
] as const;

const yesNo = {
  Yes: "Explicitly stated or requested in the description",
  No: "Explicitly denied or rejected in the description",
  unknown: "Not stated in the description",
};

const questions = {
  state: {
    type: "choice",
    instructions:
      "In which Nigerian state does the business in `businessDescription` primarily operate? Use only an explicit location statement.",
    criteria: {
      Lagos: "The business explicitly operates in Lagos",
      "Abuja FCT": "The business explicitly operates in Abuja / the Federal Capital Territory",
      Kano: "The business explicitly operates in Kano",
      Rivers: "The business explicitly operates in Rivers State (e.g. Port Harcourt)",
      Oyo: "The business explicitly operates in Oyo State (e.g. Ibadan)",
      Kaduna: "The business explicitly operates in Kaduna",
      Abia: "The business explicitly operates in Abia State",
      Ogun: "The business explicitly operates in Ogun State",
      Kwara: "The business explicitly operates in Kwara State",
      Gombe: "The business explicitly operates in Gombe State",
      Other: "An explicit location is given that is not one of the listed states",
      unknown: "No location is stated",
    },
  },
  sector: {
    type: "choice",
    instructions:
      "Which sector best describes what the business in `businessDescription` sells or does? Use only an explicit description of the business activity.",
    criteria: {
      Fashion: "Clothing, tailoring, fashion design or apparel",
      Food: "Food, catering, restaurant or cooking",
      Tech: "Technology, software or digital services",
      Beauty: "Beauty, salon or cosmetics",
      Agro: "Agriculture, farming or agro-processing",
      Other: "An explicit sector that is not one of the listed options",
      unknown: "No sector is stated",
    },
  },
  businessStage: {
    type: "choice",
    instructions:
      "What stage is the business in `businessDescription` at? Do not infer merely from the fact that a business exists.",
    criteria: {
      Starting: "Idea stage, pre-revenue, or explicitly just starting",
      Growing: "Operating and explicitly described as growing or expanding",
      Scaling: "Established and explicitly described as scaling or running multiple locations",
      unknown: "No stage is stated",
    },
  },
  cac: {
    type: "choice",
    instructions:
      "What is the CAC registration status of the business in `businessDescription`? Use only registration or incorporation evidence.",
    criteria: {
      Registered: "Explicitly CAC registered or incorporated",
      "In Progress": "CAC registration explicitly in progress",
      "Not yet": "Explicitly not registered or has no CAC",
      unknown: "No registration status is stated",
    },
  },
  age: {
    type: "choice",
    instructions:
      "What is the age range of the owner/founder in `businessDescription`? Use only an explicit statement of the person's age; a name, writing style or a young business is not evidence.",
    criteria: {
      "18–24": "The owner explicitly states an age of 18 to 24",
      "25–35": "The owner explicitly states an age of 25 to 35",
      "35+": "The owner explicitly states an age above 35",
      unknown: "No owner age is stated",
    },
  },
  womenLed: {
    type: "choice",
    instructions:
      "Is the business in `businessDescription` explicitly owned or led by a woman/women? Only explicit ownership or leadership of the business counts; the owner's name, demographics, customers or staff are not evidence.",
    criteria: {
      Yes: "The description explicitly says the business is women-owned or women-led",
      No: "The description explicitly says the business is not women-owned or women-led",
      unknown: "Ownership or leadership gender is not stated",
    },
  },
  grant: {
    type: "choice",
    instructions: "Does `businessDescription` explicitly say the owner wants or needs a grant?",
    criteria: yesNo,
  },
  loan: {
    type: "choice",
    instructions: "Does `businessDescription` explicitly say the owner wants or needs a loan?",
    criteria: yesNo,
  },
  accelerator: {
    type: "choice",
    instructions:
      "Does `businessDescription` explicitly say the owner wants or needs an accelerator programme?",
    criteria: yesNo,
  },
  fellowship: {
    type: "choice",
    instructions: "Does `businessDescription` explicitly say the owner wants or needs a fellowship?",
    criteria: yesNo,
  },
  "gov-program": {
    type: "choice",
    instructions:
      "Does `businessDescription` explicitly say the owner wants or needs a government programme?",
    criteria: yesNo,
  },
};

function parseAnswers(data: unknown): ProfileJudgments {
  if (!data || typeof data !== "object") throw new Error("Malformed OpenRouter response");
  const answers = (data as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") throw new Error("Malformed OpenRouter response");
  const out: ProfileJudgments = {};
  for (const id of QUESTION_IDS) {
    const a = (answers as Record<string, unknown>)[id];
    if (!a || typeof a !== "object") continue;
    const { type, choice, confidence, probabilities } = a as {
      type?: unknown;
      choice?: unknown;
      confidence?: unknown;
      probabilities?: unknown;
    };
    const allowed = FIELD_OPTIONS[id];
    if (type !== "choice" || typeof choice !== "string" || !allowed.includes(choice)) continue;
    if (
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    )
      continue;
    if (!probabilities || typeof probabilities !== "object") continue;
    const entries = Object.entries(probabilities);
    if (entries.length !== allowed.length || entries.some(([label]) => !allowed.includes(label)))
      continue;
    let sum = 0;
    let malformed = false;
    for (const [, p] of entries) {
      if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
        malformed = true;
        break;
      }
      sum += p;
    }
    if (malformed || Math.abs(sum - 1) > 0.01) continue;
    out[id] = { choice, confidence, probabilities: probabilities as Record<string, number> };
  }
  return out;
}

export const OPENROUTER_JEV_MODEL = "~typesafe/jev-latest";
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

export function buildOpenRouterRequest(description: string) {
  return {
    model: OPENROUTER_JEV_MODEL,
    state: { businessDescription: description },
    questions,
  };
}

async function judgeWithOpenRouterJev(description: string): Promise<ProfileJudgments> {
  const res = await fetch(OPENROUTER_DECISIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOpenRouterRequest(description)),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OpenRouter Jev evaluation failed with status ${res.status}`);
  return parseAnswers(await res.json());
}

export const interpret = action({
  args: { description: v.string() },
  returns: v.object({
    source: v.union(v.literal("typesafe"), v.literal("fallback")),
    proposals: v.array(
      v.object({
        field: v.union(...PROFILE_FIELDS.map((f) => v.literal(f))),
        value: v.string(),
        confidence: v.number(),
        probabilities: v.array(v.object({ label: v.string(), probability: v.number() })),
      }),
    ),
  }),
  handler: async (_ctx, args) =>
    await interpretProfileDescription(
      args.description,
      env.OPENROUTER_API_KEY ? judgeWithOpenRouterJev : undefined,
    ),
});
