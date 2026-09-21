import type { ClauseJudgment } from "./readinessPolicy";

// Entity resolution for providers and programs (issue #39).
//
// Imported records compare against token-blocked candidates — never the full
// catalog. Deterministic rules decide clear cases; a TypeSafe judgment
// refines uncertain pairs; anything still uncertain goes to a curator.
// Merges never delete: links overlay the records and preserve provenance.

export type EntityKind = "provider" | "program";
export type LinkRelation = "same" | "related" | "cohort" | "different" | "review";

export interface EntityRef {
  name: string;
  source?: string;
}

export interface PairJudgment {
  relation: Exclude<LinkRelation, "different"> | "different" | "review";
  confidence: number;
  reason: string;
  cohortLabel?: string;
}

export type PairJudge = (
  questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>,
  state: Record<string, unknown>,
) => Promise<Record<string, ClauseJudgment | undefined>>;

const ALIASES: Record<string, string> = {
  boi: "bank of industry",
  tef: "tony elumelu foundation",
  lsetf: "lagos state employment trust fund",
  nysc: "national youth service corps",
  smedan: "small and medium enterprises development agency of nigeria",
  cac: "corporate affairs commission",
  fgn: "federal government of nigeria",
  ncdmb: "nigerian content development and monitoring board",
  nsdc: "national sugar development council",
};

const LEGAL_SUFFIXES = new Set(["ltd", "limited", "plc", "inc", "llc", "gmbh", "pty", "co"]);

const STOPWORDS = new Set([
  "the", "of", "for", "and", "a", "an", "to", "in", "on",
  "fund", "funds", "programme", "programmes", "program", "programs",
  "nigeria", "nigerian", "project", "projects",
]);

const COHORT_RES = [
  /\b(20\d{2})\b/,
  /\bcohort\s*(\d+)\b/i,
  /\bedition\s*(\d+)\b/i,
  /\bbatch\s*(\d+)\b/i,
  /\bcycle\s*([\d/]+)\b/i,
  /\b(\d{4}\/\d{2,4})\b/,
];

/** Normalize for comparison: lowercase, alias expansion, no punctuation.
 *  Country packs may extend the shared alias table without forking it. */
export function normalizeEntityName(name: string, extraAliases: Record<string, string> = {}): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => extraAliases[t] ?? ALIASES[t] ?? t)
    .flatMap((t) => t.split(/\s+/))
    .filter((t) => !LEGAL_SUFFIXES.has(t));
  return [...new Set(tokens)].sort().join(" ");
}

export function significantTokens(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
}

export function entityHost(source: string | undefined): string | null {
  if (!source) return null;
  try {
    return new URL(source).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Registrable domain (naive last-two-labels): glow.boi.ng and
 *  iprogrammes.boi.ng are one official family; a.example.org is not. */
export function entitySiteFamily(source: string | undefined): string | null {
  const host = entityHost(source);
  if (!host) return null;
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

function tokenSet(name: string): Set<string> {
  return new Set(significantTokens(normalizeEntityName(name)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Plausible candidates share a host or at least one significant token. */
export function blockCandidates<T>(
  incoming: EntityRef,
  existing: T[],
  getName: (item: T) => string,
  getSource: (item: T) => string | undefined,
): T[] {
  const incomingTokens = tokenSet(incoming.name);
  const incomingHost = entityHost(incoming.source);
  return existing.filter((item) => {
    if (incomingHost && entityHost(getSource(item)) === incomingHost) return true;
    const tokens = tokenSet(getName(item));
    for (const t of incomingTokens) if (tokens.has(t)) return true;
    return false;
  });
}

function stripCohortMarkers(title: string): { base: string; markers: string[] } {
  let base = ` ${title} `;
  const markers: string[] = [];
  for (const re of COHORT_RES) {
    const flags = re.flags.includes("i") ? "gi" : "g";
    base = base.replace(new RegExp(re.source, flags), (m) => {
      markers.push(m.trim());
      return " ";
    });
  }
  return { base: base.replace(/\s+/g, " ").trim(), markers };
}

function deterministicJudgment(a: EntityRef, b: EntityRef): PairJudgment {
  const na = normalizeEntityName(a.name);
  const nb = normalizeEntityName(b.name);
  const hostA = entityHost(a.source);
  const hostB = entityHost(b.source);
  const familyA = entitySiteFamily(a.source);
  const familyB = entitySiteFamily(b.source);
  const sameHost = hostA !== null && hostA === hostB;
  const sameFamily = familyA !== null && familyA === familyB;
  const conflictingHosts = familyA !== null && familyB !== null && familyA !== familyB;
  if (na === nb) {
    if (!conflictingHosts) {
      return { relation: "same", confidence: 0.9, reason: "Names match after normalization." };
    }
    return { relation: "review", confidence: 0.5, reason: "Same name from different official sources — curator check." };
  }
  const ca = stripCohortMarkers(a.name);
  const cb = stripCohortMarkers(b.name);
  if (
    normalizeEntityName(ca.base) === normalizeEntityName(cb.base) &&
    (ca.markers.length > 0 || cb.markers.length > 0) &&
    ca.markers.join() !== cb.markers.join()
  ) {
    const labels = [...ca.markers, ...cb.markers].filter(Boolean);
    return {
      relation: "related",
      confidence: 0.75,
      reason: "Same programme with different cohort markers — link, don't merge.",
      cohortLabel: labels.length > 0 ? labels.join(" / ") : undefined,
    };
  }
  const tokensA = tokenSet(a.name);
  const tokensB = tokenSet(b.name);
  const shared = [...tokensA].some((t) => tokensB.has(t));
  if (!shared) {
    return { relation: "different", confidence: 0.8, reason: "No shared significant tokens." };
  }
  const overlap = jaccard(tokensA, tokensB);
  if ((sameHost || sameFamily) && overlap >= 0.6) {
    return { relation: "same", confidence: 0.65, reason: "Same official source with closely matching names." };
  }
  if (conflictingHosts) {
    return { relation: "review", confidence: 0.5, reason: "Similar names from different official sources — curator check." };
  }
  return { relation: "review", confidence: 0.55, reason: "Similar names — curator check." };
}

const PAIR_QUESTIONS = {
  entity: {
    type: "choice" as const,
    instructions:
      "Are record A and record B the same provider/programme, related (for example different cohorts of one programme), or different? Use names and official sources only.",
    criteria: {
      same: "Both records describe the same provider or programme.",
      related: "The records describe related entities, such as cohorts of one programme.",
      different: "The records describe unrelated providers or programmes.",
      uncertain: "It cannot be resolved from the names and sources.",
    },
  },
};

/** Judge a pair: deterministic rules first, Jev refines uncertain outcomes. */
export async function judgePair(
  a: EntityRef,
  b: EntityRef,
  judge?: PairJudge,
): Promise<PairJudgment> {
  const base = deterministicJudgment(a, b);
  if (!judge || base.relation === "different" || base.confidence >= 0.85) return base;
  let answers: Record<string, ClauseJudgment | undefined>;
  try {
    answers = await judge(PAIR_QUESTIONS, { a, b });
  } catch {
    return base;
  }
  const answer = answers.entity;
  if (!answer || answer.confidence < 0.7) return { ...base, confidence: Math.min(base.confidence, 0.6) };
  if (answer.choice === "uncertain") return { ...base, relation: "review", confidence: 0.5, reason: `${base.reason} Model uncertain — curator check.` };
  if (answer.choice !== "same" && answer.choice !== "related" && answer.choice !== "different") return base;
  if (answer.choice === "related") {
    return { relation: "related", confidence: answer.confidence, reason: base.reason, cohortLabel: base.cohortLabel };
  }
  return { relation: answer.choice, confidence: answer.confidence, reason: base.reason };
}
