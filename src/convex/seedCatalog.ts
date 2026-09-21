import type { Doc } from "./_generated/dataModel";

export const CATALOG_CHECKED_AT = Date.parse("2026-09-21T00:00:00Z");

export const NIGERIA_PROFILE_STATES = [
  "Lagos",
  "Abuja FCT",
  "Kano",
  "Rivers",
  "Oyo",
  "Kaduna",
  "Abia",
  "Ogun",
  "Kwara",
  "Gombe",
  "Other",
] as const;

export type SeedOpportunity = Omit<Doc<"opportunities">, "_id" | "_creationTime">;
export type SeedEvidence = Omit<
  Doc<"opportunityEvidence">,
  "_id" | "_creationTime" | "opportunityId"
>;
export type SeedCriterion = Omit<
  Doc<"readinessCriteria">,
  "_id" | "_creationTime" | "opportunityId"
>;
export type SeedGuide = Omit<
  Doc<"readinessGuides">,
  "_id" | "_creationTime" | "opportunityId"
>;
export type CatalogSeed = {
  opportunity: SeedOpportunity;
  evidence: SeedEvidence[];
  criteria: SeedCriterion[];
  guides: SeedGuide[];
};

const SCAM_NOTE =
  "Use only the official programme page and application link shown here. Never pay an agent to apply.";

const GLOW_CHECKED_AT = Date.parse("2026-09-19T00:00:00Z");
const MTN_SOURCE = "https://www.mtn.ng/mtnf-ict/";
const MTN_APPLY = "https://mtnictandbusinessskills.mtn.ng/mtn-foundation";
const NIYA_SOURCE = "https://www.niya.gov.ng/niyastartup";
const SVCG_SOURCE = "https://svcg.education.gov.ng/";
const IDICE_SOURCE =
  "https://idice.boi.ng/beneficiary/e48e9666-1161-4158-8747-49080975d1ce/details";
const RAPID_SOURCE = "https://rapid.boi.ng/";
const RAPID_REGISTER = "https://rapid.boi.ng/register";

function manualReviewCriterion(
  criterionKey: string,
  label: string,
  requirement: string,
  guidance: string,
): SeedCriterion {
  return {
    criterionKey,
    label,
    profileField: "cac",
    operator: "present",
    expectedValues: [],
    requirement,
    hardness: "hard",
    evidenceClaimKey: criterionKey,
    guidance,
  };
}

function manualReviewEvidence(
  claimKey: string,
  displayValue: string,
  note: string,
  sourceUrl: string,
): SeedEvidence {
  return {
    claimType: "eligibility",
    claimKey,
    displayValue,
    status: "pending-review",
    sourceUrl,
    checkedAt: CATALOG_CHECKED_AT,
    note,
  };
}

export const SEEDED_PROVIDERS = [
  {
    name: "Bank of Industry",
    type: "Bank",
    verified: true,
    officialLink: "https://www.boi.ng",
  },
  {
    name: "MTN Foundation",
    type: "Foundation",
    verified: true,
    officialLink: "https://www.mtn.ng/foundation/",
  },
  {
    name: "Federal Ministry of Youth Development",
    type: "Ministry",
    verified: true,
    officialLink: "https://www.niya.gov.ng/",
  },
  {
    name: "Federal Ministry of Education",
    type: "Ministry",
    verified: true,
    officialLink: "https://svcg.education.gov.ng/",
  },
];

const GLOW: CatalogSeed = {
  opportunity: {
    title: "GLOW — Guaranteed Loans for Women",
    providerName: "Bank of Industry",
    providerType: "Bank",
    type: "loan",
    amountOrBenefit: "Affordable financing + mentorship + capacity building",
    deadlineNote: "No application deadline is published on the official programme page.",
    catalogVisibility: "public",
    locationEligibility: "All Nigeria",
    sectorTags: ["all"],
    summaryPlain:
      "A Bank of Industry programme for women-owned businesses, offering affordable financing, mentorship and capacity building across sectors in Nigeria.",
    eligibilityRules: ["Women-owned business", "Business operates in Nigeria"],
    steps: [
      {
        order: 1,
        title: "Review the official programme summary",
        detail: "Confirm the programme is still marked active by Bank of Industry.",
        link: "https://iprogrammes.boi.ng/",
      },
      {
        order: 2,
        title: "Open the GLOW portal",
        detail: "Follow the current application instructions published on the official portal.",
        link: "https://glow.boi.ng/",
      },
    ],
    documents: [],
    contacts: { officialLink: "https://glow.boi.ng/" },
    sourceUrl: "https://iprogrammes.boi.ng/",
    lastVerified: GLOW_CHECKED_AT,
    status: "verified",
    scamNote:
      "Use only the official BOI programme and GLOW portals. Confirm unexpected payment requests with BOI.",
    womenOnly: true,
    youthOnly: false,
    effort: "Check the official portal",
  },
  evidence: [
    {
      claimType: "benefit",
      claimKey: "benefit",
      displayValue: "Affordable financing + mentorship + capacity building",
      status: "supported",
      sourceUrl: "https://iprogrammes.boi.ng/",
      checkedAt: GLOW_CHECKED_AT,
      sourcePassage:
        "A ₦10 billion fund empowering women-owned businesses with affordable financing, mentorship, and capacity-building programmes across all sectors in Nigeria.",
    },
    {
      claimType: "applicationStatus",
      claimKey: "application-status",
      displayValue: "Active",
      status: "supported",
      sourceUrl: "https://iprogrammes.boi.ng/",
      checkedAt: GLOW_CHECKED_AT,
      sourcePassage: "Active intervention funds currently accepting applications",
    },
    {
      claimType: "deadline",
      claimKey: "deadline",
      displayValue: "No application deadline published",
      status: "pending-review",
      sourceUrl: "https://iprogrammes.boi.ng/",
      checkedAt: GLOW_CHECKED_AT,
      sourcePassage: "Active GLOW - Guaranteed Loans for Women",
      note: "The official programme page marks GLOW active but does not publish an application deadline.",
    },
    {
      claimType: "eligibility",
      claimKey: "business-in-nigeria",
      displayValue: "Business operates in Nigeria",
      status: "pending-review",
      sourceUrl: "https://iprogrammes.boi.ng/",
      checkedAt: GLOW_CHECKED_AT,
      sourcePassage: "across all sectors in Nigeria",
      note: "This describes the programme scope but is not a complete eligibility rule.",
    },
    {
      claimType: "eligibility",
      claimKey: "women-owned-business",
      displayValue: "Women-owned business",
      status: "supported",
      sourceUrl: "https://iprogrammes.boi.ng/",
      checkedAt: GLOW_CHECKED_AT,
      sourcePassage: "A ₦10 billion fund empowering women-owned businesses",
    },
    {
      claimType: "contact",
      claimKey: "direct-contact",
      displayValue: "No direct GLOW phone or email published",
      status: "unsupported",
      sourceUrl: "https://iprogrammes.boi.ng/",
      checkedAt: GLOW_CHECKED_AT,
      note: "No supporting contact passage was captured from the reviewed programme page.",
    },
    {
      claimType: "officialDestination",
      claimKey: "official-destination",
      displayValue: "https://glow.boi.ng/",
      status: "supported",
      sourceUrl: "https://iprogrammes.boi.ng/",
      checkedAt: GLOW_CHECKED_AT,
      sourcePassage: "Visit Portal",
      note: "The Bank of Industry programme hub links this destination for GLOW.",
    },
  ],
  criteria: [
    {
      criterionKey: "women-owned-business",
      label: "Women-owned business",
      profileField: "womenLed",
      operator: "equals",
      expectedValues: ["true"],
      requirement: "The business must be women-owned or women-led.",
      hardness: "hard",
      evidenceClaimKey: "women-owned-business",
      guidance: "Confirm whether women own or lead the business.",
    },
    {
      criterionKey: "business-in-nigeria",
      label: "Business operates in Nigeria",
      profileField: "state",
      operator: "one-of",
      expectedValues: [...NIGERIA_PROFILE_STATES],
      requirement: "The business must operate in Nigeria.",
      hardness: "hard",
      evidenceClaimKey: "business-in-nigeria",
      guidance: "Confirm the state where the business operates.",
    },
  ],
  guides: [
    {
      criterionKey: "business-in-nigeria",
      family: "geography",
      appliesTo: ["all"],
      lastChecked: GLOW_CHECKED_AT,
      title: "Confirm GLOW's location requirement",
      detail:
        "Check the current GLOW portal or ask Bank of Industry whether businesses in your state can apply before relying on this opportunity.",
      sourceUrl: "https://glow.boi.ng/",
      costEstimate: "No application or verification cost is published.",
      dependencies: ["Current GLOW programme terms", "Your confirmed operating state"],
      uncertainty:
        "The programme summary describes support in Nigeria but does not publish a complete location eligibility rule.",
      alternativeTitle: "Compare another source-linked opportunity",
      alternativeDetail:
        "Keep GLOW saved and review another opportunity while the location requirement is being confirmed.",
    },
    {
      criterionKey: "women-owned-business",
      family: "ownership",
      appliesTo: ["all"],
      lastChecked: GLOW_CHECKED_AT,
      title: "Confirm women ownership or leadership",
      detail:
        "Review the official GLOW description and confirm your profile only if women own or lead the business.",
      sourceUrl: "https://iprogrammes.boi.ng/",
      costEstimate: "No cost is required to confirm this profile fact.",
      dependencies: ["Accurate ownership or leadership information"],
      uncertainty:
        "Backbone cannot infer ownership demographics from a name or business description.",
      alternativeTitle: "Review opportunities without a women-ownership requirement",
      alternativeDetail:
        "If women do not own or lead the business, do not apply to GLOW; compare another source-linked opportunity instead.",
    },
  ],
};

const MTN: CatalogSeed = {
  opportunity: {
    title: "MTN ICT and Business Skills Training — Phase 8",
    providerName: "MTN Foundation",
    providerType: "Foundation",
    type: "accelerator",
    amountOrBenefit:
      "Five-week ICT and business training with data support; top 100 participants may receive up to ₦1 million in equipment grants",
    deadline: Date.parse("2026-10-11T23:59:59+01:00"),
    catalogVisibility: "public",
    locationEligibility: "Rivers, Abia, Ogun, Kwara, Kano & Gombe",
    sectorTags: ["all"],
    summaryPlain:
      "A five-week blended ICT and business-skills programme for young women running microbusinesses in six Nigerian states, with competitive equipment grants for the top 100 participants.",
    eligibilityRules: [
      "Nigerian woman aged 18–35",
      "Owns and manages a microbusiness operating for no more than two years",
      "Business is in Rivers, Abia, Ogun, Kwara, Kano, or Gombe",
    ],
    steps: [
      {
        order: 1,
        title: "Review the eligibility criteria",
        detail: "Confirm your age, business age, and state on the official MTN Foundation page.",
        link: MTN_SOURCE,
      },
      {
        order: 2,
        title: "Complete the official application",
        detail:
          "Accept the programme terms and complete every compulsory field before 11 October 2026.",
        link: MTN_APPLY,
      },
    ],
    documents: [],
    contacts: { officialLink: MTN_APPLY },
    sourceUrl: MTN_SOURCE,
    lastVerified: CATALOG_CHECKED_AT,
    status: "verified",
    scamNote: SCAM_NOTE,
    womenOnly: true,
    youthOnly: true,
    effort: "Five-week blended training",
  },
  evidence: [
    {
      claimType: "benefit",
      claimKey: "benefit",
      displayValue:
        "Five-week ICT and business training with data support; top 100 participants may receive up to ₦1 million in equipment grants",
      status: "supported",
      sourceUrl: MTN_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "The top 100 participants will receive up to ₦1,000,000 in equipment grants, from a ₦100,000,000 fund.",
    },
    {
      claimType: "applicationStatus",
      claimKey: "application-status",
      displayValue: "Applications open",
      status: "supported",
      sourceUrl: MTN_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "Call for Applications – MTN ICT and Business Skills Training Programme (Phase 8)",
    },
    {
      claimType: "deadline",
      claimKey: "deadline",
      displayValue: "Applications close 11 October 2026",
      status: "supported",
      sourceUrl: MTN_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Applications will close on October 11, 2026.",
    },
    {
      claimType: "eligibility",
      claimKey: "women-and-age",
      displayValue: "Nigerian woman aged 18–35",
      status: "supported",
      sourceUrl: MTN_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Nigerian woman aged 18–35",
    },
    {
      claimType: "eligibility",
      claimKey: "eligible-states",
      displayValue: "Rivers, Abia, Ogun, Kwara, Kano & Gombe",
      status: "supported",
      sourceUrl: MTN_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "Phase 8 will train 3,000 female microbusiness owners from Rivers, Abia, Ogun, Kwara, Kano and Gombe states.",
    },
    {
      claimType: "eligibility",
      claimKey: "business-age",
      displayValue: "Microbusiness operating for no more than two years",
      status: "supported",
      sourceUrl: MTN_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Owns and manages a micro business operational for no more than 2 years",
    },
    {
      claimType: "officialDestination",
      claimKey: "official-destination",
      displayValue: MTN_APPLY,
      status: "supported",
      sourceUrl: MTN_APPLY,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Click here to apply",
    },
    manualReviewEvidence(
      "manual-review-mtn",
      "Business age must be confirmed manually",
      "Backbone does not yet collect business operating age, so confirm the two-year limit on the official page.",
      MTN_SOURCE,
    ),
  ],
  criteria: [
    {
      criterionKey: "women-led-founder",
      label: "Women-owned or women-led business",
      profileField: "womenLed",
      operator: "equals",
      expectedValues: ["true"],
      requirement: "The applicant must be a Nigerian woman who owns and manages the microbusiness.",
      hardness: "hard",
      evidenceClaimKey: "women-and-age",
      guidance: "Confirm whether a woman owns and manages the business.",
    },
    {
      criterionKey: "founder-age",
      label: "Founder aged 18–35",
      profileField: "age",
      operator: "one-of",
      expectedValues: ["18–24", "25–35"],
      requirement: "The applicant must be aged 18–35.",
      hardness: "hard",
      evidenceClaimKey: "women-and-age",
      guidance: "Confirm the founder's age range.",
    },
    {
      criterionKey: "eligible-state",
      label: "Business in an eligible state",
      profileField: "state",
      operator: "one-of",
      expectedValues: ["Rivers", "Abia", "Ogun", "Kwara", "Kano", "Gombe"],
      requirement:
        "The business must operate in Rivers, Abia, Ogun, Kwara, Kano, or Gombe.",
      hardness: "hard",
      evidenceClaimKey: "eligible-states",
      guidance: "Confirm the state where the business operates.",
    },
    manualReviewCriterion(
      "manual-review-mtn",
      "Business operating age",
      "The microbusiness must have operated for no more than two years.",
      "Confirm on the official MTN Foundation page that the business has operated for no more than two years.",
    ),
  ],
  guides: [
    {
      criterionKey: "manual-review-mtn",
      title: "Confirm how long the business has operated",
      detail:
        "Check that the microbusiness has operated for no more than two years before applying.",
      sourceUrl: MTN_SOURCE,
      costEstimate: "No application fee is published.",
      dependencies: ["Business start date"],
      uncertainty: "Backbone does not yet store business operating age.",
      alternativeTitle: "Review another source-linked opportunity",
      alternativeDetail:
        "Compare another programme if the business is older than two years.",
      family: "business-age",
      appliesTo: ["all"],
      lastChecked: CATALOG_CHECKED_AT,
    },
  ],
};

const NIYA: CatalogSeed = {
  opportunity: {
    title: "NiYA Startup 2.0",
    providerName: "Federal Ministry of Youth Development",
    providerType: "Agency",
    type: "gov-program",
    amountOrBenefit: "Compete for support from a ₦100 million startup fund",
    deadlineNote: "No application deadline is published on the official NiYA page.",
    catalogVisibility: "public",
    locationEligibility: "All Nigeria",
    sectorTags: ["all"],
    summaryPlain:
      "A Federal Ministry of Youth Development startup programme for Nigerian founders aged 18–35, requiring a team, NiYA profile, completed NiYA course, and pitch deck.",
    eligibilityRules: [
      "Founder aged 18–35",
      "Currently lives in Nigeria",
      "At least two co-founders — no solo entries",
      "Completed NiYA community profile and NiYA course",
      "Pitch deck",
    ],
    steps: [
      {
        order: 1,
        title: "Review the programme requirements",
        detail:
          "Confirm the age, residency, team, course, and pitch-deck requirements on the official NiYA page.",
        link: NIYA_SOURCE,
      },
      {
        order: 2,
        title: "Apply on the official NiYA page",
        detail:
          "Apply as a new member or an existing member through the official NiYA portal.",
        link: NIYA_SOURCE,
      },
    ],
    documents: [
      {
        name: "Pitch deck",
        required: true,
        howToGet: "Use the sample linked from the official NiYA page.",
      },
      {
        name: "NiYA course completion certificate",
        required: true,
        howToGet: "Complete a NiYA course before applying.",
      },
    ],
    contacts: { officialLink: NIYA_SOURCE },
    sourceUrl: NIYA_SOURCE,
    lastVerified: CATALOG_CHECKED_AT,
    status: "verified",
    scamNote: SCAM_NOTE,
    youthOnly: true,
    effort: "Complete profile, course, and pitch deck",
  },
  evidence: [
    {
      claimType: "benefit",
      claimKey: "benefit",
      displayValue: "Compete for support from a ₦100 million startup fund",
      status: "supported",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "₦100,000,000 for Nigerian Startup & Entrepreneurs",
    },
    {
      claimType: "applicationStatus",
      claimKey: "application-status",
      displayValue: "Open to youth founders in Nigeria",
      status: "supported",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Open to Youth Founders In Nigeria!",
    },
    {
      claimType: "deadline",
      claimKey: "deadline",
      displayValue: "No application deadline published",
      status: "pending-review",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      note: "The official NiYA page does not publish an application deadline.",
    },
    {
      claimType: "eligibility",
      claimKey: "founder-age",
      displayValue: "Founder aged 18–35",
      status: "supported",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "18–35 years",
    },
    {
      claimType: "eligibility",
      claimKey: "nigeria-resident",
      displayValue: "Currently lives in Nigeria",
      status: "supported",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Must currently live in Nigeria",
    },
    {
      claimType: "eligibility",
      claimKey: "team",
      displayValue: "At least two co-founders",
      status: "supported",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Youth Founders only, with at least two co-founders (no solo entries)",
    },
    {
      claimType: "eligibility",
      claimKey: "course-and-pitch",
      displayValue: "Completed NiYA profile, course, and pitch deck",
      status: "supported",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "A Completed NiYA Community Profile; A course Completion certificate from NiYA; Pitch Deck",
    },
    {
      claimType: "officialDestination",
      claimKey: "official-destination",
      displayValue: NIYA_SOURCE,
      status: "supported",
      sourceUrl: NIYA_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Apply as a New Member; Apply as an Existing Member",
    },
    manualReviewEvidence(
      "manual-review-niya",
      "Co-founder count and NiYA course completion must be confirmed manually",
      "Backbone does not yet collect co-founder count or NiYA course completion, so confirm both on the official page.",
      NIYA_SOURCE,
    ),
  ],
  criteria: [
    {
      criterionKey: "founder-age",
      label: "Founder aged 18–35",
      profileField: "age",
      operator: "one-of",
      expectedValues: ["18–24", "25–35"],
      requirement: "The founder must be aged 18–35.",
      hardness: "hard",
      evidenceClaimKey: "founder-age",
      guidance: "Confirm the founder's age range.",
    },
    {
      criterionKey: "nigeria-resident",
      label: "Currently lives in Nigeria",
      profileField: "state",
      operator: "one-of",
      expectedValues: [...NIGERIA_PROFILE_STATES],
      requirement: "The founder must currently live in Nigeria.",
      hardness: "hard",
      evidenceClaimKey: "nigeria-resident",
      guidance: "Confirm the state where you live.",
    },
    manualReviewCriterion(
      "manual-review-niya",
      "Team and NiYA prerequisites",
      "The application requires at least two co-founders, a completed NiYA community profile and course, and a pitch deck.",
      "Confirm your team, completed NiYA course, and pitch deck on the official NiYA page.",
    ),
  ],
  guides: [
    {
      criterionKey: "manual-review-niya",
      title: "Confirm your team and NiYA prerequisites",
      detail:
        "Check that you have at least two co-founders, a completed NiYA community profile and course, and a pitch deck.",
      sourceUrl: NIYA_SOURCE,
      costEstimate: "No application fee is published.",
      dependencies: [
        "At least two co-founders",
        "Completed NiYA community profile and course",
        "Pitch deck",
      ],
      uncertainty:
        "Backbone does not yet store co-founder count or NiYA course completion.",
      alternativeTitle: "Compare another youth programme",
      alternativeDetail:
        "Review another source-linked opportunity if your team cannot meet these prerequisites.",
      appliesTo: ["all"],
      lastChecked: CATALOG_CHECKED_AT,
    },
  ],
};

const SVCG: CatalogSeed = {
  opportunity: {
    title: "Student Venture Capital Grant (S-VCG)",
    providerName: "Federal Ministry of Education",
    providerType: "Ministry",
    type: "grant",
    amountOrBenefit:
      "Milestone-based equity-free funding; the current cycle advertises up to ₦50 million in available grant funding",
    deadlineNote: "No application deadline is published on the official S-VCG page.",
    catalogVisibility: "public",
    locationEligibility: "All Nigeria",
    sectorTags: ["tech", "agro", "health", "engineering", "science"],
    summaryPlain:
      "A Federal Ministry of Education grant for student-led STEMM ventures in Nigerian tertiary institutions, combining validation support with milestone-based equity-free funding.",
    eligibilityRules: [
      "Enrolled student at a Nigerian tertiary institution",
      "Team lead is at least 300 level or its equivalent",
      "Venture is registered with the Corporate Affairs Commission (CAC)",
      "Venture is in a STEMM field",
      "Project is beyond proof of concept",
    ],
    steps: [
      {
        order: 1,
        title: "Review the programme FAQ",
        detail:
          "Confirm the enrolment, study level, CAC, STEMM, and venture-stage requirements on the official S-VCG page.",
        link: SVCG_SOURCE,
      },
      {
        order: 2,
        title: "Create an account and apply",
        detail: "Register and submit the application on the official S-VCG portal.",
        link: SVCG_SOURCE,
      },
    ],
    documents: [
      {
        name: "CAC registration",
        required: true,
        howToGet: "Register the venture with the Corporate Affairs Commission.",
      },
      {
        name: "Business plan with milestones and KPIs",
        required: true,
        howToGet: "Prepare a business plan with milestones and KPIs before applying.",
      },
      {
        name: "Pitch video",
        required: true,
        howToGet: "Record a pitch video describing the venture.",
      },
    ],
    contacts: { officialLink: SVCG_SOURCE },
    sourceUrl: SVCG_SOURCE,
    lastVerified: CATALOG_CHECKED_AT,
    status: "verified",
    scamNote: SCAM_NOTE,
    womenOnly: false,
    youthOnly: false,
    effort: "Business plan, pitch video, and multi-stage review",
  },
  evidence: [
    {
      claimType: "benefit",
      claimKey: "benefit",
      displayValue:
        "Milestone-based equity-free funding; the current cycle advertises up to ₦50 million in available grant funding",
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Up to ₦50M grant funding available in the current S-VCG cycle",
    },
    {
      claimType: "applicationStatus",
      claimKey: "application-status",
      displayValue: "Applications open",
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "APPLY NOW",
    },
    {
      claimType: "deadline",
      claimKey: "deadline",
      displayValue: "No application deadline published",
      status: "pending-review",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      note: "The official S-VCG page does not publish an application deadline.",
    },
    {
      claimType: "eligibility",
      claimKey: "student",
      displayValue: "Enrolled student at a Nigerian tertiary institution",
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "You must be a student currently enrolled in a Nigerian tertiary institution — that includes universities, polytechnics, and colleges of education.",
    },
    {
      claimType: "eligibility",
      claimKey: "level",
      displayValue: "Team lead at 300 level or equivalent",
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "You must be at least 300 level (or its equivalent) at your institution.",
    },
    {
      claimType: "eligibility",
      claimKey: "cac",
      displayValue: "CAC-registered venture",
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "Yes. Your project or innovation must have a business name registered with CAC-registered company in Nigeria.",
    },
    {
      claimType: "eligibility",
      claimKey: "stemm",
      displayValue: "Venture in a STEMM field",
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "We’re looking for ideas, solutions, projects, or businesses that fall under STEMMS — that’s Science, Technology, Engineering, Mathematics, and Medical Sciences.",
    },
    {
      claimType: "eligibility",
      claimKey: "venture-stage",
      displayValue: "Beyond proof of concept",
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Your project or business concept must be beyond proof of concept",
    },
    {
      claimType: "officialDestination",
      claimKey: "official-destination",
      displayValue: SVCG_SOURCE,
      status: "supported",
      sourceUrl: SVCG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "APPLY NOW",
    },
    manualReviewEvidence(
      "manual-review-svcg",
      "Enrolment, study level, and venture maturity must be confirmed manually",
      "Backbone does not yet collect enrolment status, study level, or venture maturity, so confirm all three on the official page.",
      SVCG_SOURCE,
    ),
  ],
  criteria: [
    {
      criterionKey: "cac-registered",
      label: "CAC-registered venture",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "The venture must have a business name registered with CAC.",
      hardness: "hard",
      evidenceClaimKey: "cac",
      guidance: "Confirm the venture's CAC registration status.",
    },
    manualReviewCriterion(
      "manual-review-svcg",
      "Student and venture requirements",
      "The team lead must be an enrolled student at 300 level or equivalent, and the venture must be beyond proof of concept.",
      "Confirm your enrolment, study level, and venture stage on the official S-VCG page.",
    ),
  ],
  guides: [
    {
      criterionKey: "manual-review-svcg",
      title: "Confirm student and venture requirements",
      detail:
        "Check that the team lead is enrolled at 300 level or equivalent and that the STEMM venture is beyond proof of concept.",
      sourceUrl: SVCG_SOURCE,
      costEstimate: "No application fee is published.",
      dependencies: [
        "Enrolment and study level",
        "STEMM venture beyond proof of concept",
        "Business plan and pitch video",
      ],
      uncertainty:
        "Backbone does not yet store enrolment status, study level, or venture maturity.",
      alternativeTitle: "Review another source-linked opportunity",
      alternativeDetail:
        "Compare another programme if you are not an enrolled student.",
      appliesTo: ["all"],
      lastChecked: CATALOG_CHECKED_AT,
    },
  ],
};

const IDICE: CatalogSeed = {
  opportunity: {
    title: "BOI–iDICE Debt Fund",
    providerName: "Bank of Industry",
    providerType: "Bank",
    type: "loan",
    amountOrBenefit:
      "Debt financing for eligible youth-led technology and creative businesses, with a separate Sharia-compliant financing option",
    deadlineNote: "No application deadline is published on the official iDICE page.",
    catalogVisibility: "public",
    locationEligibility: "All Nigeria",
    sectorTags: ["tech", "fashion", "creative"],
    summaryPlain:
      "A Bank of Industry iDICE fund providing debt financing to eligible youth-led technology and creative businesses in Nigeria, including a separate Sharia-compliant financing option.",
    eligibilityRules: [
      "Duly registered Nigerian business",
      "Operates in an eligible technology or creative subsector",
      "Demonstrates commercial viability and growth potential",
      "Meets regulatory, KYC/AML, and credit requirements",
      "Shows capacity for rapid scale and innovation",
    ],
    steps: [
      {
        order: 1,
        title: "Choose a fund and read the criteria",
        detail: "Review the Debt Fund eligibility criteria on the official iDICE page.",
        link: IDICE_SOURCE,
      },
      {
        order: 2,
        title: "Express your interest",
        detail:
          "Select your preferred financing option and signify your interest on the official iDICE page.",
        link: IDICE_SOURCE,
      },
    ],
    documents: [],
    contacts: { officialLink: IDICE_SOURCE },
    sourceUrl: IDICE_SOURCE,
    lastVerified: CATALOG_CHECKED_AT,
    status: "verified",
    scamNote: SCAM_NOTE,
    youthOnly: true,
    effort: "Expression of interest followed by credit assessment",
  },
  evidence: [
    {
      claimType: "benefit",
      claimKey: "benefit",
      displayValue:
        "Debt financing for eligible youth-led technology and creative businesses, with a separate Sharia-compliant financing option",
      status: "supported",
      sourceUrl: IDICE_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "The iDICE Debt Fund is designed to provide accessible financing to eligible youth-led technology and creative businesses.",
    },
    {
      claimType: "applicationStatus",
      claimKey: "application-status",
      displayValue: "Expressions of interest open",
      status: "supported",
      sourceUrl: IDICE_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "Please select your preferred financing option and signify your interest in the fund",
    },
    {
      claimType: "deadline",
      claimKey: "deadline",
      displayValue: "No application deadline published",
      status: "pending-review",
      sourceUrl: IDICE_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      note: "The official iDICE page does not publish an application deadline.",
    },
    {
      claimType: "eligibility",
      claimKey: "registered-business",
      displayValue: "Duly registered Nigerian business",
      status: "supported",
      sourceUrl: IDICE_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Be duly registered Nigerian businesses",
    },
    {
      claimType: "eligibility",
      claimKey: "eligible-sector",
      displayValue: "Eligible technology or creative subsector",
      status: "supported",
      sourceUrl: IDICE_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "Operate within eligible technology and creative industry subsectors",
    },
    {
      claimType: "eligibility",
      claimKey: "viability",
      displayValue: "Commercial viability and growth potential",
      status: "supported",
      sourceUrl: IDICE_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Demonstrate commercial viability and growth potential",
    },
    {
      claimType: "officialDestination",
      claimKey: "official-destination",
      displayValue: IDICE_SOURCE,
      status: "supported",
      sourceUrl: IDICE_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Choose a fund to express your interest.",
    },
    manualReviewEvidence(
      "manual-review-idice",
      "Subsector, viability, and KYC requirements must be confirmed manually",
      "Backbone cannot evaluate eligible subsector, commercial viability, or KYC/AML requirements, so confirm them on the official page.",
      IDICE_SOURCE,
    ),
  ],
  criteria: [
    {
      criterionKey: "registered-business",
      label: "Duly registered Nigerian business",
      profileField: "cac",
      operator: "equals",
      expectedValues: ["Registered"],
      requirement: "The business must be duly registered in Nigeria.",
      hardness: "hard",
      evidenceClaimKey: "registered-business",
      guidance: "Confirm the business's CAC registration status.",
    },
    manualReviewCriterion(
      "manual-review-idice",
      "Sector, viability, and finance requirements",
      "The business must operate in an eligible subsector and meet BOI's viability, KYC/AML, and credit requirements.",
      "Confirm your subsector, viability, and finance requirements on the official iDICE page.",
    ),
  ],
  guides: [
    {
      criterionKey: "manual-review-idice",
      title: "Confirm sector, viability, and finance requirements",
      detail:
        "Check that the business operates in an eligible technology or creative subsector and can meet BOI's viability, KYC/AML, and credit requirements.",
      sourceUrl: IDICE_SOURCE,
      costEstimate: "No application fee is published.",
      dependencies: [
        "Eligible technology or creative subsector",
        "Commercial records showing viability and growth",
        "KYC/AML and credit requirements",
      ],
      uncertainty:
        "These requirements are decided by Bank of Industry's assessment and are not stored in your profile.",
      alternativeTitle: "Compare another source-linked opportunity",
      alternativeDetail:
        "Review another programme if the business cannot meet the finance requirements.",
      appliesTo: ["all"],
      lastChecked: CATALOG_CHECKED_AT,
    },
  ],
};

const RAPID: CatalogSeed = {
  opportunity: {
    title: "RAPID — Rural Area Programme on Investment for Development",
    providerName: "Bank of Industry",
    providerType: "Bank",
    type: "loan",
    amountOrBenefit:
      "Rural-enterprise financing and advisory support; BOI lists up to ₦10 million at 5% per annum",
    deadlineNote: "No application deadline is published on the official RAPID page.",
    catalogVisibility: "public",
    locationEligibility: "Rural and economically disadvantaged areas in Nigeria",
    sectorTags: ["all"],
    summaryPlain:
      "A Bank of Industry programme providing financing and advisory support to micro and small businesses and community groups in rural and economically disadvantaged areas of Nigeria.",
    eligibilityRules: [
      "Micro or small business, or community group, in a rural or economically disadvantaged area",
      "Completed application form",
      "Business plan",
      "Valid identification",
      "BVN and NIN",
      "Residential address",
      "Completed guarantor forms",
    ],
    steps: [
      {
        order: 1,
        title: "Review the programme page",
        detail: "Read the eligibility and documentation requirements on the official RAPID page.",
        link: RAPID_SOURCE,
      },
      {
        order: 2,
        title: "Prepare your documents",
        detail:
          "Gather the business plan, identification, BVN and NIN, address proof, and guarantor forms.",
        link: RAPID_SOURCE,
      },
      {
        order: 3,
        title: "Register on the RAPID portal",
        detail: "Create an account and apply at the official registration page.",
        link: RAPID_REGISTER,
      },
    ],
    documents: [
      {
        name: "Business plan",
        required: true,
        howToGet: "Prepare a business plan for the enterprise before applying.",
      },
      {
        name: "Valid identification",
        required: true,
        howToGet: "Provide an accepted form of identification.",
      },
      {
        name: "BVN and NIN",
        required: true,
        howToGet: "Provide your Bank Verification Number and National Identification Number.",
      },
      {
        name: "Proof of residential address",
        required: true,
        howToGet: "Provide a document showing your residential address.",
      },
      {
        name: "Completed guarantor forms",
        required: true,
        howToGet: "Complete the guarantor forms provided by the programme.",
      },
    ],
    contacts: { email: "customercare@boi.ng", officialLink: RAPID_REGISTER },
    sourceUrl: RAPID_SOURCE,
    lastVerified: CATALOG_CHECKED_AT,
    status: "verified",
    scamNote: SCAM_NOTE,
    effort: "Business plan and guarantor documentation",
  },
  evidence: [
    {
      claimType: "benefit",
      claimKey: "benefit",
      displayValue:
        "Rural-enterprise financing and advisory support; BOI lists up to ₦10 million at 5% per annum",
      status: "supported",
      sourceUrl: "https://onlineportal.boi.ng/",
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Benefits: Up to ₦10M at 5% p.a.",
    },
    {
      claimType: "applicationStatus",
      claimKey: "application-status",
      displayValue: "Registration open",
      status: "supported",
      sourceUrl: RAPID_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Visit: rapid.boi.ng/register",
    },
    {
      claimType: "deadline",
      claimKey: "deadline",
      displayValue: "No application deadline published",
      status: "pending-review",
      sourceUrl: RAPID_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      note: "The official RAPID page does not publish an application deadline.",
    },
    {
      claimType: "eligibility",
      claimKey: "rural-business",
      displayValue: "Business or community group in a rural area",
      status: "supported",
      sourceUrl: RAPID_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "The objective of the programme is to assist communities in rural and economically disadvantaged areas to tap into available resources for the development of enterprises that can provide employment, improve standard of living, contribute to national growth and tame insecurity arising from youth restiveness.",
    },
    {
      claimType: "eligibility",
      claimKey: "target-market",
      displayValue: "Micro and small businesses; community groups in rural areas",
      status: "supported",
      sourceUrl: RAPID_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Micro and Small Businesses; Community Groups in Rural Areas",
    },
    {
      claimType: "eligibility",
      claimKey: "documents",
      displayValue: "Business plan, ID, BVN/NIN, address proof, and guarantor forms",
      status: "supported",
      sourceUrl: RAPID_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage:
        "Business Plan; Valid Identification; BVN and NIN; Proof of Residential Address; Completed Guarantor Forms",
    },
    {
      claimType: "officialDestination",
      claimKey: "official-destination",
      displayValue: RAPID_REGISTER,
      status: "supported",
      sourceUrl: RAPID_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
      sourcePassage: "Visit: rapid.boi.ng/register",
    },
    manualReviewEvidence(
      "manual-review-rapid",
      "Rural eligibility and guarantor readiness must be confirmed manually",
      "Backbone does not yet collect rural or underserved status or guarantor readiness, so confirm both on the official page.",
      RAPID_SOURCE,
    ),
  ],
  criteria: [
    manualReviewCriterion(
      "manual-review-rapid",
      "Rural eligibility and guarantor forms",
      "The business or community group must be in a rural or economically disadvantaged area and provide guarantor forms.",
      "Confirm your location and guarantor documentation on the official RAPID page.",
    ),
  ],
  guides: [
    {
      criterionKey: "manual-review-rapid",
      title: "Confirm rural eligibility and required documents",
      detail:
        "Check that the business or community group is in a rural or economically disadvantaged area and that all required documents are ready.",
      sourceUrl: RAPID_SOURCE,
      costEstimate: "No application fee is published.",
      dependencies: [
        "Rural business or residential address",
        "Business plan",
        "Valid identification",
        "BVN and NIN",
        "Completed guarantor forms",
      ],
      uncertainty:
        "Bank of Industry decides rural eligibility and creditworthiness; Backbone cannot pre-check either.",
      alternativeTitle: "Compare another source-linked opportunity",
      alternativeDetail:
        "Review another programme if the business is not in a rural area.",
      appliesTo: ["all"],
      lastChecked: CATALOG_CHECKED_AT,
    },
  ],
};

export const SEEDED_CATALOG: CatalogSeed[] = [GLOW, MTN, NIYA, SVCG, IDICE, RAPID];
