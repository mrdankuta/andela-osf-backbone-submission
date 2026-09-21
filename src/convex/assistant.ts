import { query } from "./_generated/server";
import { v } from "convex/values";
import { isPublicOpportunity } from "./catalogPolicy";
import { verifyCitation } from "./groundingPolicy";
import { buildReadinessPlan } from "./opportunities";

const NO_DEADLINE_TEXT =
  "No application deadline is published; check the official portal for current timing.";

type PlanShape = {
  overall: string;
  planStatus: string;
  gap: {
    label: string;
    result: string;
    hardness: string;
    requirement: string;
    guidance?: string;
  } | null;
  action: {
    title: string;
    detail: string;
    expectedDaysMin: number | null;
    expectedDaysMax: number | null;
    costEstimate: string;
    uncertainty: string;
  } | null;
  deadline: { status: string; daysAvailable: number | null };
  alternative: { title: string; detail: string; url: string | null } | null;
};

type ExplainLang = "plain" | "pidgin";

const VERDICT_PLAIN: Record<string, string> = {
  ready: "You are ready for this opportunity.",
  "can-become-ready": "You can become ready. One or more steps are left.",
  "not-currently-eligible": "You are not currently eligible. Do not apply unless the terms change.",
  "needs-information": "We do not know yet whether you qualify. More confirmed facts are needed.",
};

const VERDICT_PIDGIN: Record<string, string> = {
  ready: "You dey eligible. No wahala.",
  "can-become-ready": "You fit become ready. Small steps remain.",
  "not-currently-eligible": "You no dey eligible now. No apply unless di terms change.",
  "needs-information": "We no know yet whether you qualify. We need confirmed facts.",
};

const RESULT_PLAIN: Record<string, string> = {
  met: "met",
  unmet: "not met",
  unknown: "unknown",
  ambiguous: "unclear",
  "needs-evidence": "awaiting evidence",
};

const RESULT_PIDGIN: Record<string, string> = {
  met: "don complete",
  unmet: "never complete",
  unknown: "we no know",
  ambiguous: "e no clear",
  "needs-evidence": "evidence never land",
};

/** Build a full-fidelity explanation from the typed plan. Every dynamic
 *  slot carries a typed value verbatim — amounts, dates, conditions,
 *  negation, and uncertainty survive by construction. */
export function explainPlanText(
  plan: PlanShape,
  opportunity: { amountOrBenefit: string; deadline?: number; contacts: { officialLink: string } },
  lang: ExplainLang,
  asOf?: number,
): string {
  const pidgin = lang === "pidgin";
  const verdicts = pidgin ? VERDICT_PIDGIN : VERDICT_PLAIN;
  const results = pidgin ? RESULT_PIDGIN : RESULT_PLAIN;
  const lines = [verdicts[plan.overall] ?? plan.overall];
  if (plan.gap) {
    const state = results[plan.gap.result] ?? plan.gap.result;
    lines.push(
      pidgin
        ? `${plan.gap.label}: ${state}. ${plan.gap.guidance ?? plan.gap.requirement}`
        : `${plan.gap.label}: ${state}. ${plan.gap.guidance ?? plan.gap.requirement}`,
    );
    if (plan.gap.hardness === "hard" && plan.gap.result === "unmet") {
      lines.push(pidgin ? "Dis one na blocking requirement. No apply." : "This is a blocking requirement. Do not apply.");
    }
  }
  if (plan.action) {
    const hasRange = plan.action.expectedDaysMin !== null && plan.action.expectedDaysMax !== null;
    const time = hasRange
      ? `${plan.action.expectedDaysMin}–${plan.action.expectedDaysMax} days`
      : pidgin
        ? "time dem no publish"
        : "time not published";
    lines.push(
      pidgin
        ? `Next step: ${plan.action.title} — ${plan.action.detail} (Time: ${time}; Cost: ${plan.action.costEstimate}.)`
        : `Next step: ${plan.action.title} — ${plan.action.detail} (Expected time: ${time}; Cost: ${plan.action.costEstimate}.)`,
    );
    lines.push(pidgin ? `We no too sure: ${plan.action.uncertainty}` : `Uncertainty: ${plan.action.uncertainty}`);
  }
  if (opportunity.deadline === undefined) {
    lines.push(
      pidgin
        ? "Dem never publish deadline. Check di official portal for timing."
        : "No application deadline is published; check the official portal for current timing.",
    );
  } else {
    const date = new Date(opportunity.deadline).toLocaleDateString();
    const days =
      plan.deadline.daysAvailable ??
      (asOf !== undefined ? Math.max(0, Math.floor((opportunity.deadline - asOf) / 86400000)) : null);
    lines.push(
      pidgin
        ? `Deadline: ${plan.deadline.status} (${date})${days !== null ? ` — ${days} days remain` : ""}.`
        : `Deadline: ${plan.deadline.status} (${date})${days !== null ? ` — ${days} days available` : ""}.`,
    );
  }
  lines.push(
    pidgin
      ? `Benefit: ${opportunity.amountOrBenefit}.`
      : `Benefit: ${opportunity.amountOrBenefit}.`,
  );
  if (plan.alternative) {
    lines.push(
      pidgin
        ? `Instead: ${plan.alternative.title} — ${plan.alternative.detail}`
        : `Other option: ${plan.alternative.title} — ${plan.alternative.detail}`,
    );
  }
  lines.push(`Official portal: ${opportunity.contacts.officialLink}.`);
  if (pidgin) {
    lines.push("Na English be di original; if anytin confuse you, follow di English and di official portal.");
  }
  return lines.join("\n");
}

export const explain = query({
  args: {
    id: v.id("opportunities"),
    mode: v.string(),
    state: v.optional(v.string()),
    sector: v.optional(v.string()),
    businessStage: v.optional(v.string()),
    cac: v.optional(v.string()),
    staffSize: v.optional(v.number()),
    age: v.optional(v.string()),
    womenLed: v.optional(v.boolean()),
    asOf: v.optional(v.number()),
  },
  returns: v.union(
    v.object({
      text: v.string(),
      citation: v.string(),
      officialLink: v.string(),
      quote: v.union(v.object({ text: v.string(), sourceUrl: v.string() }), v.null()),
      citationVerified: v.boolean(),
      citationNote: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const o = await ctx.db.get("opportunities", args.id);
    if (!isPublicOpportunity(o)) return null;
    const timing = (format: (date: string) => string) =>
      o.deadline === undefined ? NO_DEADLINE_TEXT : format(new Date(o.deadline).toLocaleDateString());
    const m = args.mode.toLowerCase();
    // Full-fidelity plan explanations: plain English and Pidgin render the
    // typed readiness result, so critical meaning survives by construction.
    if (m.includes("plain") || m.includes("pidgin")) {
      const plan = await buildReadinessPlan(ctx, args.id, {
        state: args.state,
        sector: args.sector,
        businessStage: args.businessStage,
        cac: args.cac,
        staffSize: args.staffSize,
        age: args.age,
        womenLed: args.womenLed,
        asOf: args.asOf ?? Date.now(),
      });
      if (plan) {
        const text = explainPlanText(plan, o, m.includes("pidgin") ? "pidgin" : "plain", args.asOf ?? Date.now());
        const rows = await ctx.db
          .query("opportunityEvidence")
          .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.id))
          .take(50);
        const candidate = rows.find((r) => r.status === "supported" && r.sourcePassage);
        let quote: { text: string; sourceUrl: string } | null = null;
        let citationVerified = false;
        let citationNote = "No stored passage backs this yet — verify on the official portal.";
        if (candidate?.sourcePassage) {
          const check = verifyCitation(candidate.sourcePassage, rows);
          if (check.verdict === "verified") {
            quote = { text: candidate.sourcePassage, sourceUrl: candidate.sourceUrl };
            citationVerified = true;
            citationNote = "";
          } else if (check.verdict === "contradicted") {
            citationNote = "Sources disagree on this passage — see the evidence section, don't rely on either.";
          }
        }
        return { text, citation: `Source: ${o.sourceUrl} · verified ${new Date(o.lastVerified).toLocaleDateString()}`, officialLink: o.contacts.officialLink, quote, citationVerified, citationNote };
      }
    }
    let text = `In plain words: ${o.summaryPlain} ${timing((d) => `Apply via the official portal before ${d}.`)}`;
    if (m.includes("doc")) text = o.documents.length > 0
      ? `You need: ${o.documents.map((d) => d.name).join(", ")}. Start with ${o.documents[0]?.name} — ${o.documents[0]?.howToGet}.`
      : `The official page does not list fixed documents — check ${o.contacts.officialLink} for current requirements.`;
    else if (m.includes("elig")) text = `Likely eligible if: ${o.eligibilityRules.join("; ")}.`;
    else if (m.includes("yoruba")) text = `O ṣeéṣe kí o gba ${o.amountOrBenefit}. ${timing((d) => `Forukọsilẹ̀ kí o tó di ${d}.`)}`;
    else if (m.includes("hausa")) text = `Wata alama: ka cancanci ${o.amountOrBenefit}. ${timing((d) => `Yi rajista kafin ${d}.`)}`;
    else if (m.includes("igbo")) text = `Ị tozuru maka ${o.amountOrBenefit}. ${timing((d) => `Debanye aha tupu ${d}.`)}`;
    else if (m.includes("pidgin")) text = `You fit for ${o.amountOrBenefit}. Na wetin you go do: follow di steps for checklist.`;
    // Critical quotes must exist in stored sources before display as grounded.
    const topics = m.includes("elig")
      ? ["eligibility"]
      : m.includes("doc")
        ? []
        : ["benefit", "applicationStatus"];
    let quote: { text: string; sourceUrl: string } | null = null;
    let citationVerified = false;
    let citationNote = "";
    if (topics.length > 0) {
      const rows = await ctx.db
        .query("opportunityEvidence")
        .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.id))
        .take(50);
      const candidate = rows.find(
        (r) => topics.includes(r.claimType) && r.status === "supported" && r.sourcePassage,
      );
      if (candidate?.sourcePassage) {
        const check = verifyCitation(candidate.sourcePassage, rows);
        if (check.verdict === "verified") {
          quote = { text: candidate.sourcePassage, sourceUrl: candidate.sourceUrl };
          citationVerified = true;
        } else if (check.verdict === "contradicted") {
          citationNote = "Sources disagree on this passage — see the evidence section, don't rely on either.";
        } else {
          citationNote = "No stored passage fully backs this yet — verify on the official portal.";
        }
      } else {
        citationNote = "No stored passage backs this yet — verify on the official portal.";
      }
    } else {
      citationNote = "Listed from the official page — ask for the source passage.";
    }
    return { text, citation: `Source: ${o.sourceUrl} · verified ${new Date(o.lastVerified).toLocaleDateString()}`, officialLink: o.contacts.officialLink, quote, citationVerified, citationNote };
  },
});
