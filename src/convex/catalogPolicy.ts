import type { Doc } from "./_generated/dataModel";

const PLACEHOLDER_HOSTS = ["example.com", "example.net", "example.org", "example.ng"];

function isSafeSourceUrl(value: string | undefined): boolean {
  if (!value) return false;
  let hostname: string;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    hostname = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return !PLACEHOLDER_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

type OpportunityLike = Pick<
  Doc<"opportunities">,
  "status" | "catalogVisibility" | "sourceUrl" | "contacts"
>;

export function isPublicOpportunity<T extends OpportunityLike | null | undefined>(
  o: T,
): o is Exclude<T, null | undefined> {
  return (
    !!o &&
    o.status === "verified" &&
    o.catalogVisibility === "public" &&
    isSafeSourceUrl(o.sourceUrl) &&
    isSafeSourceUrl(o.contacts.officialLink)
  );
}

export function compareByDeadline(a: number | undefined, b: number | undefined): number {
  const missing = Number.MAX_SAFE_INTEGER;
  return (a ?? missing) - (b ?? missing);
}
