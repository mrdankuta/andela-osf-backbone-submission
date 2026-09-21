import { query } from "./_generated/server";
import { v } from "convex/values";
import { isPublicOpportunity } from "./catalogPolicy";
import { buildReadinessPlan, loadEvidenceForOpportunity, loadReadiness } from "./opportunities";

// Bounded router: natural-language assistant requests are classified into
// typed readiness functions. Code authorizes and executes the function; the
// agent only ever explains the typed result, so deterministic eligibility and
// readiness verdicts cannot be overridden by chat.

export const assistantRoute = v.union(
  v.literal("evidence"),
  v.literal("criterion"),
  v.literal("next-action"),
  v.literal("alternative"),
  v.literal("clarify"),
  v.literal("unsupported"),
);

export type AssistantRoute = "evidence" | "criterion" | "next-action" | "alternative" | "clarify" | "unsupported";

const ROUTE_KEYWORDS: Record<Exclude<AssistantRoute, "clarify" | "unsupported">, string[]> = {
  evidence: [
    "evidence",
    "proof",
    "prove",
    "source",
    "verified",
    "verify",
    "support",
    "backing",
    "backed",
    "citation",
    "cite",
  ],
  criterion: ["eligib", "criteri", "requirement", "qualif", "rule", "can i apply", "do i qualify", "who can"],
  "next-action": [
    "next step",
    "what should i do",
    "what do i do",
    "how do i",
    "how to",
    "action",
    "apply",
    "steps",
    "checklist",
    "get ready",
    "prepare",
  ],
  alternative: [
    "alternative",
    "other option",
    "instead",
    "another",
    "other opportunit",
    "blocked",
    "cannot",
    "can't",
    "ineligible",
    "not eligible",
    "too late",
    "missed",
  ],
};

const UNSUPPORTED_KEYWORDS = [
  "write my",
  "draft",
  "lend",
  "give me money",
  "loan me",
  "joke",
  "story",
  "song",
  "bet ",
  "crypto",
  "football",
  "visa",
  "recipe",
  "homework",
  "exam",
  "politic",
  "election",
];

const ROUTE_LABELS: Record<Exclude<AssistantRoute, "clarify" | "unsupported">, string> = {
  evidence: "the evidence behind a claim",
  criterion: "an eligibility criterion",
  "next-action": "your next step",
  alternative: "alternatives",
};

export function routeRequest(text: string): {
  route: AssistantRoute;
  clarifyingQuestion?: string;
} {
  const lower = text.toLowerCase();
  const matched = (Object.entries(ROUTE_KEYWORDS) as [keyof typeof ROUTE_KEYWORDS, string[]][]).flatMap(
    ([route, keywords]) => (keywords.some((k) => lower.includes(k)) ? [route] : []),
  );
  if (matched.length === 1) return { route: matched[0] };
  if (matched.length > 1) {
    const options = matched.map((r) => ROUTE_LABELS[r]).join(", ");
    return {
      route: "clarify",
      clarifyingQuestion: `That could be about ${options} — which one do you mean?`,
    };
  }
  if (UNSUPPORTED_KEYWORDS.some((k) => lower.includes(k))) return { route: "unsupported" };
  return {
    route: "clarify",
    clarifyingQuestion:
      "I can help with the evidence behind a claim, an eligibility criterion, your next step, or alternatives for this opportunity — which do you need?",
  };
}

const answerFactArgs = {
  state: v.optional(v.string()),
  sector: v.optional(v.string()),
  businessStage: v.optional(v.string()),
  cac: v.optional(v.string()),
  staffSize: v.optional(v.number()),
  age: v.optional(v.string()),
  womenLed: v.optional(v.boolean()),
};

type AnswerFacts = {
  state?: string;
  sector?: string;
  businessStage?: string;
  cac?: string;
  staffSize?: number;
  age?: string;
  womenLed?: boolean;
};

function unique(items: (string | null | undefined)[]): string[] {
  return [...new Set(items.filter((u): u is string => typeof u === "string" && u.length > 0))];
}

export const answerRequest = query({
  args: {
    opportunityId: v.id("opportunities"),
    text: v.string(),
    facts: v.optional(v.object(answerFactArgs)),
    asOf: v.optional(v.number()),
  },
  returns: v.union(
    v.object({
      route: assistantRoute,
      reply: v.string(),
      citations: v.array(v.string()),
      clarifyingQuestion: v.optional(v.string()),
      uncertainty: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const opp = await ctx.db.get("opportunities", args.opportunityId);
    if (!isPublicOpportunity(opp)) return null;
    const { route, clarifyingQuestion } = routeRequest(args.text);
    const officialLine = `Official portal: ${opp.contacts.officialLink}.`;
    if (route === "clarify") {
      return { route, reply: clarifyingQuestion ?? "", citations: [], clarifyingQuestion };
    }
    if (route === "unsupported") {
      return {
        route,
        reply:
          "I can only help with this opportunity's evidence, eligibility criteria, next steps, or alternatives. For anything else, use the official portal.",
        citations: [opp.contacts.officialLink],
      };
    }
    const facts: AnswerFacts = args.facts ?? {};
    if (route === "evidence") {
      const result = await loadEvidenceForOpportunity(ctx, args.opportunityId);
      if (!result) return null;
      const lines = result.claims.map(
        (c) => `• ${c.displayValue}: ${c.status} — ${c.sourceUrl}${c.note ? ` (${c.note})` : ""}`,
      );
      const pending = result.claims.filter(
        (c) => c.status === "pending-review" || c.status === "unsupported",
      ).length;
      return {
        route,
        reply: [
          `Evidence for ${opp.title}: ${result.summary.supported}/${result.summary.total} key claims supported (${result.summary.status}).`,
          ...lines,
          officialLine,
        ].join("\n"),
        citations: unique(result.claims.map((c) => c.sourceUrl)),
        uncertainty:
          pending > 0 ? `${pending} claim${pending === 1 ? "" : "s"} still need${pending === 1 ? "s" : ""} review.` : undefined,
      };
    }
    if (route === "criterion") {
      const result = await loadReadiness(ctx, args.opportunityId, facts);
      if (!result) return null;
      const lines = result.assessments.map(
        (a) => `• ${a.label}: ${a.result} — ${a.guidance ?? a.requirement}`,
      );
      return {
        route,
        reply: [`Readiness verdict: ${result.overall}.`, ...lines, officialLine].join("\n"),
        citations: unique(result.assessments.map((a) => a.evidence?.sourceUrl)),
        uncertainty:
          result.overall === "needs-information"
            ? "Some answers are still missing, so this verdict may change once you confirm them."
            : undefined,
      };
    }
    const plan = await buildReadinessPlan(ctx, args.opportunityId, {
      ...facts,
      asOf: args.asOf ?? Date.now(),
    });
    if (!plan) return null;
    if (route === "next-action") {
      const citations = unique([
        plan.action?.sourceUrl,
        plan.gap?.evidence?.sourceUrl,
        plan.alternative?.url,
      ]);
      if (plan.planStatus === "ready") {
        return {
          route,
          reply: [`You look ready for ${opp.title}.`, officialLine].join("\n"),
          citations,
        };
      }
      if (!plan.gap) {
        return {
          route,
          reply: [
            `Readiness verdict: ${plan.overall}. Confirm the missing business details to get a next step.`,
            officialLine,
          ].join("\n"),
          citations,
          uncertainty: "The next step is unknown until the missing details are confirmed.",
        };
      }
      const time =
        plan.action &&
        (plan.action.expectedDaysMin !== null || plan.action.expectedDaysMax !== null)
          ? `Expected time: ${plan.action.expectedDaysMin ?? "?"}–${plan.action.expectedDaysMax ?? "?"} days.`
          : "No published time estimate.";
      const deadline =
        plan.deadline.status === "unknown"
          ? "Deadline feasibility unknown."
          : `Deadline: ${plan.deadline.status}${plan.deadline.daysAvailable !== null ? ` (${plan.deadline.daysAvailable} days left)` : ""}.`;
      const guideNotes = [
        plan.action?.matchNote,
        plan.action?.stale ? "This guide may be stale — verify the current terms." : undefined,
      ].filter((n): n is string => typeof n === "string");
      return {
        route,
        reply: [
          `${plan.gap.label}: ${plan.gap.result} (${plan.gap.hardness}).`,
          plan.action ? `${plan.action.title} — ${plan.action.detail}` : (plan.gap.guidance ?? plan.gap.requirement),
          ...guideNotes,
          time,
          deadline,
          officialLine,
        ].join("\n"),
        citations,
        uncertainty: plan.action?.uncertainty,
      };
    }
    if (!plan.alternative) {
      return {
        route,
        reply: [
          `No alternative is published for this path (${plan.planStatus}). Compare other source-linked opportunities instead.`,
          officialLine,
        ].join("\n"),
        citations: unique([plan.action?.sourceUrl, plan.gap?.evidence?.sourceUrl]),
      };
    }
    return {
      route,
      reply: [
        `${plan.alternative.title} — ${plan.alternative.detail}`,
        plan.alternative.url ? `More: ${plan.alternative.url}` : officialLine,
      ].join("\n"),
      citations: unique([plan.alternative.url, plan.action?.sourceUrl]),
    };
  },
});
