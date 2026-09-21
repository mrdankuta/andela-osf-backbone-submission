// Pure source-monitoring helpers (issue #40).
//
// Scheduled checks record reachability, a content version, and check time.
// A changed hash with a large length swing counts as a meaningful change;
// small tweaks update the version without paging a curator. Thresholds are
// explicit constants, not vibes.

export const MEANINGFUL_TOKEN_OVERLAP = 0.5;
const SIGNATURE_TOKENS = 300;

function contentTokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9₦\s]/gi, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, SIGNATURE_TOKENS * 2)
  );
}

/** Bounded bag-of-words signature for change comparison. */
export function tokenSignature(text: string): string[] {
  return [...new Set(contentTokens(text))].slice(0, SIGNATURE_TOKENS);
}

function tokenOverlap(prevSig: string[], nextText: string): number {
  if (prevSig.length === 0) return 1;
  const next = new Set(contentTokens(nextText));
  let shared = 0;
  for (const t of prevSig) if (next.has(t)) shared += 1;
  return shared / prevSig.length;
}

/** FNV-1a 32-bit hash as hex — dependency-free content versioning. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export type ChangeVerdict =
  | { changed: false }
  | { changed: true; meaningful: boolean; ratio: number };

export function judgeContentChange(
  prevHash: string | null,
  prevSig: string[] | null,
  nextText: string,
): ChangeVerdict {
  const nextHash = hashText(nextText);
  if (prevHash !== null && prevHash === nextHash) return { changed: false };
  if (prevSig === null) {
    return { changed: true, meaningful: false, ratio: 1 };
  }
  const overlap = tokenOverlap(prevSig, nextText);
  return { changed: true, meaningful: overlap < MEANINGFUL_TOKEN_OVERLAP, ratio: overlap };
}

export type FreshnessState = "ok" | "stale" | "unavailable" | "under-review" | "closed";

export function displayFreshness(args: {
  status: string;
  lastChecked?: number;
  unreachable: boolean;
  changedUnreviewed: boolean;
  hasOpenFlag: boolean;
}): { state: FreshnessState; lastChecked: number | null } {
  if (args.status === "expired") return { state: "closed", lastChecked: args.lastChecked ?? null };
  if (args.unreachable) return { state: "unavailable", lastChecked: args.lastChecked ?? null };
  if (args.hasOpenFlag) return { state: "under-review", lastChecked: args.lastChecked ?? null };
  if (args.changedUnreviewed) return { state: "stale", lastChecked: args.lastChecked ?? null };
  return { state: "ok", lastChecked: args.lastChecked ?? null };
}
