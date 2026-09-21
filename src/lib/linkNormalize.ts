// Shared-link normalization for the WhatsApp intake (issue #43).
//
// Forwards arrive with tracking parameters, fragments, casing noise, and
// shorteners we cannot resolve offline. Normalization is conservative:
// strip what is certainly noise, never guess identity across hosts.

export function normalizeSharedUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!host.includes(".")) return null;
  const params = new URLSearchParams(url.search);
  const noise = [...params.keys()].filter(
    (k) => k.startsWith("utm_") || k === "fbclid" || k === "gclid" || k === "igshid" || k === "si",
  );
  for (const k of noise) params.delete(k);
  const query = params.toString();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/** Two links match when their normalized forms are identical. */
export function sameNormalizedUrl(a: string, b: string): boolean {
  const na = normalizeSharedUrl(a);
  const nb = normalizeSharedUrl(b);
  return na !== null && na === nb;
}
