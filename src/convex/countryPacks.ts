// Country packs for geographic scaling (issue #56).
//
// A pack is DATA, never a fork: normalized geography, institutional
// aliases, criterion mappings, verified guides, and language behavior for
// one country. The shared eligibility, evidence, and readiness engine runs
// both packs unchanged — callers never branch on country.

export interface PackLanguage {
  code: string;
  label: string;
  official: boolean;
  fidelity: "full" | "fallback";
}

export interface PackGuide {
  criterionKey: string;
  title: string;
  detail: string;
  sourceUrl: string;
  costEstimate: string;
  dependencies: string[];
  uncertainty: string;
  alternativeTitle: string;
  alternativeDetail: string;
}

export interface CountryPack {
  countryCode: string;
  countryName: string;
  regions: string[];
  institutionAliases: Record<string, string>;
  fieldMapping: Record<string, string>;
  languages: PackLanguage[];
  guides: PackGuide[];
}

export const NIGERIA_PACK: CountryPack = {
  countryCode: "NG",
  countryName: "Nigeria",
  regions: ["Lagos", "Abuja FCT", "Kano", "Rivers", "Oyo", "Kaduna", "Abia", "Ogun", "Kwara", "Gombe", "Other"],
  institutionAliases: {
    boi: "bank of industry",
  },
  fieldMapping: { geography: "state" },
  languages: [
    { code: "en", label: "English", official: true, fidelity: "full" },
    { code: "pidgin", label: "Pidgin", official: false, fidelity: "full" },
    { code: "yoruba", label: "Yoruba", official: false, fidelity: "fallback" },
    { code: "hausa", label: "Hausa", official: false, fidelity: "fallback" },
    { code: "igbo", label: "Igbo", official: false, fidelity: "fallback" },
  ],
  guides: [],
};

export const GHANA_PACK: CountryPack = {
  countryCode: "GH",
  countryName: "Ghana",
  regions: [
    "Greater Accra",
    "Ashanti",
    "Western",
    "Central",
    "Eastern",
    "Northern",
    "Volta",
    "Bono",
    "Bono East",
    "Ahafo",
    "Western North",
    "Oti",
    "Savannah",
    "North East",
    "Upper East",
    "Upper West",
  ],
  institutionAliases: {
    gea: "ghana enterprises agency",
    nbssi: "ghana enterprises agency",
  },
  fieldMapping: { geography: "state" },
  languages: [
    { code: "en", label: "English", official: true, fidelity: "full" },
    { code: "pidgin", label: "Pidgin", official: false, fidelity: "full" },
    { code: "tw", label: "Twi", official: false, fidelity: "fallback" },
  ],
  guides: [
    {
      criterionKey: "ghana-region",
      title: "Confirm the Ghana region of operation",
      detail:
        "Check the programme page or ask Ghana Enterprises Agency whether businesses in your region can apply before relying on this opportunity.",
      sourceUrl: "https://gea.gov.gh/",
      costEstimate: "No application or verification cost is published.",
      dependencies: ["Current programme terms", "Your confirmed region of operation"],
      uncertainty:
        "GEA lists many programmes centrally; region rules differ per programme and are confirmed at review.",
      alternativeTitle: "Compare another source-linked opportunity",
      alternativeDetail: "Keep this saved and review another opportunity while the region rule is confirmed.",
    },
    {
      criterionKey: "ghana-youth",
      title: "Confirm youth eligibility",
      detail:
        "GEA youth programmes target young people; confirm the exact age band on the programme page before relying on it.",
      sourceUrl: "https://gea.gov.gh/",
      costEstimate: "No cost is required to confirm profile facts.",
      dependencies: ["Accurate founder age information"],
      uncertainty: "Published pages describe youth focus without always stating exact age bands.",
      alternativeTitle: "Review programmes without a youth requirement",
      alternativeDetail: "If outside the youth band, compare another source-linked opportunity instead.",
    },
  ],
};

export const COUNTRY_PACKS: Record<string, CountryPack> = {
  NG: NIGERIA_PACK,
  GH: GHANA_PACK,
};

export type ResolvedLanguage =
  | { lang: "en" | "pidgin"; fallback: false }
  | { lang: "en"; fallback: true; governsNote: string };

/** Resolve a requested language through the pack. Official English always
 *  governs; unsupported local languages fall back explicitly, never silently. */
export function resolveExplanationLanguage(pack: CountryPack, requested: string): ResolvedLanguage {
  const code = requested.trim().toLowerCase();
  if (code === "en" || code === "english" || code === "plain") return { lang: "en", fallback: false };
  if (code === "pidgin") return { lang: "pidgin", fallback: false };
  const known = pack.languages.find((l) => l.code === code);
  if (known && known.fidelity === "full") {
    return { lang: code === "pidgin" ? "pidgin" : "en", fallback: false };
  }
  const official = pack.languages.find((l) => l.official);
  return {
    lang: "en",
    fallback: true,
    governsNote: `${requested} is not fully supported in ${pack.countryName} yet — showing ${official?.label ?? "English"}, which governs.`,
  };
}
