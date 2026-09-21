import type { Doc } from "./_generated/dataModel";

// Confidence-aware guide alignment (issue #33).
//
// A readiness gap aligns against the bounded guide catalog deterministically:
// an exact criterion-key hit wins outright, a same-family guide is a related
// (uncertain) candidate, and anything else is an explicit no-match — never a
// silent wrong guide. Freshness is computed from lastChecked, never assumed.

export const GUIDE_EXACT_CONFIDENCE = 1.0;
export const GUIDE_RELATED_CONFIDENCE = 0.6;
export const GUIDE_STALE_AFTER_DAYS = 180;

export type GuideMatchOutcome = "exact" | "related" | "none";

export type GuideLike = {
  criterionKey: string;
  family?: string;
  appliesTo?: string[];
};

export type GuideMatch<T extends GuideLike = GuideLike> =
  | { outcome: "exact"; guide: T; confidence: typeof GUIDE_EXACT_CONFIDENCE }
  | { outcome: "related"; guide: T; confidence: typeof GUIDE_RELATED_CONFIDENCE; note: string }
  | { outcome: "none"; guide: null; confidence: 0 };

export function alignGuideToGap<T extends GuideLike>(
  gap: { criterionKey: string; family?: string },
  guides: T[],
  profileState?: string,
): GuideMatch<T> {
  const exact = guides.find((g) => g.criterionKey === gap.criterionKey);
  if (exact) return { outcome: "exact", guide: exact, confidence: GUIDE_EXACT_CONFIDENCE };
  if (!gap.family) return { outcome: "none", guide: null, confidence: 0 };
  const related = guides
    .filter((g) => g.family !== undefined && g.family === gap.family)
    .sort((a, b) => {
      const rank = (g: T) => {
        const applies = g.appliesTo ?? [];
        if (profileState && applies.includes(profileState)) return 0;
        if (applies.length === 0 || applies.includes("all")) return 1;
        return 2;
      };
      return rank(a) - rank(b) || a.criterionKey.localeCompare(b.criterionKey);
    })[0];
  if (!related) return { outcome: "none", guide: null, confidence: 0 };
  return {
    outcome: "related",
    guide: related,
    confidence: GUIDE_RELATED_CONFIDENCE,
    note: "Closely related guide, not written for this exact requirement — confirm it fits before relying on it.",
  };
}

export type GuideFreshness =
  | { stale: false; lastChecked: number }
  | { stale: true; lastChecked: number | null; note: string };

export function guideFreshness(
  guide: { lastChecked?: number },
  now: number,
): GuideFreshness {
  if (guide.lastChecked === undefined) {
    return { stale: true, lastChecked: null, note: "Freshness unknown — verify the current terms." };
  }
  const ageDays = Math.floor((now - guide.lastChecked) / 86400000);
  if (ageDays > GUIDE_STALE_AFTER_DAYS) {
    return {
      stale: true,
      lastChecked: guide.lastChecked,
      note: `Last checked ${ageDays} days ago — verify the current terms.`,
    };
  }
  return { stale: false, lastChecked: guide.lastChecked };
}

export type ReadinessGuideDoc = Doc<"readinessGuides">;
