import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const opportunityType = v.union(
  v.literal("grant"),
  v.literal("loan"),
  v.literal("accelerator"),
  v.literal("incubator"),
  v.literal("fellowship"),
  v.literal("gov-program"),
);

export const opportunityStatus = v.union(
  v.literal("verified"),
  v.literal("unverified"),
  v.literal("expired"),
);

export const evidenceClaimType = v.union(
  v.literal("benefit"),
  v.literal("applicationStatus"),
  v.literal("deadline"),
  v.literal("eligibility"),
  v.literal("contact"),
  v.literal("officialDestination"),
);

export const evidenceStatus = v.union(
  v.literal("supported"),
  v.literal("unsupported"),
  v.literal("contradicted"),
  v.literal("pending-review"),
);

export const profileFactField = v.union(
  v.literal("state"),
  v.literal("sector"),
  v.literal("businessStage"),
  v.literal("cac"),
  v.literal("staffSize"),
  v.literal("age"),
  v.literal("womenLed"),
);

export const criterionOperator = v.union(
  v.literal("equals"),
  v.literal("one-of"),
  v.literal("present"),
  v.literal("at-least"),
  v.literal("at-most"),
);

export const criterionHardness = v.union(
  v.literal("hard"),
  v.literal("remediable"),
);

export const importDecision = v.object({
  fieldKey: v.string(),
  decision: v.union(
    v.literal("accept"),
    v.literal("correct"),
    v.literal("reject"),
    v.literal("ambiguous"),
  ),
  correctedValue: v.optional(v.string()),
  reviewer: v.string(),
  decidedAt: v.number(),
});

export const importDraftField = v.object({
  status: v.union(v.literal("proposed"), v.literal("unresolved")),
  value: v.union(v.string(), v.null()),
  passage: v.union(v.string(), v.null()),
  confidence: v.number(),
});

export const importDraftCriterion = v.union(
  importDraftField,
  v.object({
    field: importDraftField,
    family: v.string(),
    role: v.string(),
  }),
);

const step = v.object({
  order: v.number(),
  title: v.string(),
  detail: v.string(),
  link: v.optional(v.string()),
});

const docItem = v.object({
  name: v.string(),
  required: v.boolean(),
  howToGet: v.string(),
});

export default defineSchema({
  opportunities: defineTable({
    title: v.string(),
    providerName: v.string(),
    providerType: v.string(),
    type: opportunityType,
    amountOrBenefit: v.string(),
    deadline: v.optional(v.number()),
    deadlineNote: v.optional(v.string()),
    catalogVisibility: v.optional(
      v.union(v.literal("public"), v.literal("demo"), v.literal("hidden")),
    ),
    locationEligibility: v.string(),
    sectorTags: v.array(v.string()),
    summaryPlain: v.string(),
    eligibilityRules: v.array(v.string()),
    steps: v.array(step),
    documents: v.array(docItem),
    contacts: v.object({
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      office: v.optional(v.string()),
      officialLink: v.string(),
    }),
    sourceUrl: v.string(),
    lastVerified: v.number(),
    status: opportunityStatus,
    scamNote: v.optional(v.string()),
    womenOnly: v.optional(v.boolean()),
    youthOnly: v.optional(v.boolean()),
    effort: v.optional(v.string()),
    amountValue: v.optional(v.number()),
    screenshots: v.optional(v.array(v.string())),
    lastChecked: v.optional(v.number()),
    sourceStatus: v.optional(
      v.union(v.literal("ok"), v.literal("stale"), v.literal("unavailable"), v.literal("under-review")),
    ),
  })
    .index("by_type", ["type"])
    .index("by_deadline", ["deadline"])
    .index("by_status", ["status"])
    .index("by_status_and_catalogVisibility", ["status", "catalogVisibility"])
    .index("by_sourceUrl", ["sourceUrl"])
    .searchIndex("search_text", {
      searchField: "title",
      filterFields: ["type", "status"],
    }),
  sourceChecks: defineTable({
    opportunityId: v.id("opportunities"),
    sourceUrl: v.string(),
    checkedAt: v.number(),
    reachable: v.boolean(),
    statusCode: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    contentLength: v.optional(v.number()),
    tokenSig: v.optional(v.array(v.string())),
    changed: v.boolean(),
    meaningfulChange: v.boolean(),
    error: v.optional(v.string()),
  }).index("by_opportunityId", ["opportunityId"]),
  opportunityEvidence: defineTable({
    opportunityId: v.id("opportunities"),
    claimType: evidenceClaimType,
    claimKey: v.string(),
    displayValue: v.string(),
    status: evidenceStatus,
    sourceUrl: v.string(),
    sourcePassage: v.optional(v.string()),
    note: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_opportunityId", ["opportunityId"]),
  readinessCriteria: defineTable({
    opportunityId: v.id("opportunities"),
    criterionKey: v.string(),
    label: v.string(),
    profileField: profileFactField,
    operator: criterionOperator,
    expectedValues: v.array(v.string()),
    requirement: v.string(),
    hardness: criterionHardness,
    evidenceClaimKey: v.string(),
    guidance: v.optional(v.string()),
    family: v.optional(v.string()),
    role: v.optional(v.string()),
    alternativeGroup: v.optional(v.string()),
    exceptionTo: v.optional(v.string()),
    documentType: v.optional(v.string()),
  }).index("by_opportunityId", ["opportunityId"]),
  readinessGuides: defineTable({
    opportunityId: v.id("opportunities"),
    criterionKey: v.string(),
    title: v.string(),
    detail: v.string(),
    sourceUrl: v.string(),
    expectedDaysMin: v.optional(v.number()),
    expectedDaysMax: v.optional(v.number()),
    costEstimate: v.string(),
    dependencies: v.array(v.string()),
    uncertainty: v.string(),
    alternativeTitle: v.string(),
    alternativeDetail: v.string(),
    alternativeUrl: v.optional(v.string()),
    family: v.optional(v.string()),
    appliesTo: v.optional(v.array(v.string())),
    lastChecked: v.optional(v.number()),
  }).index("by_opportunityId", ["opportunityId"]),
  track: defineTable({
    opportunityId: v.id("opportunities"),
    deviceId: v.string(),
    ticked: v.array(v.number()),
    status: v.union(
      v.literal("saved"),
      v.literal("in-progress"),
      v.literal("applied"),
      v.literal("qualifying"),
      v.literal("ready"),
      v.literal("applying"),
      v.literal("abandoned"),
    ),
    updatedAt: v.number(),
    guideCriterionKey: v.optional(v.string()),
    guideTitle: v.optional(v.string()),
    guideDoneAt: v.optional(v.number()),
    abandonReason: v.optional(v.string()),
  }).index("by_device", ["deviceId"]),
  flags: defineTable({
    opportunityId: v.id("opportunities"),
    reason: v.string(),
    note: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
    category: v.optional(v.string()),
    claimKey: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("now"), v.literal("queue"))),
    routingConfidence: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    duplicateCount: v.optional(v.number()),
    outcome: v.optional(v.union(v.literal("fixed"), v.literal("no-issue"), v.literal("escalated"))),
    resolvedNote: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  }).index("by_status", ["status"]),
  importDrafts: defineTable({
    sourceUrl: v.string(),
    capturedAt: v.number(),
    captureStatus: v.union(v.literal("captured"), v.literal("failed")),
    captureError: v.optional(v.string()),
    snapshotText: v.optional(v.string()),
    title: importDraftField,
    benefit: importDraftField,
    deadline: importDraftField,
    deadlineAt: v.union(v.number(), v.null()),
    contacts: importDraftField,
    criteria: v.array(importDraftCriterion),
    programStatus: importDraftField,
    applyDestination: importDraftField,
    reviewStatus: v.union(
      v.literal("needs-review"),
      v.literal("published"),
      v.literal("discarded"),
    ),
    decisions: v.optional(v.array(importDecision)),
    publishedOpportunityId: v.optional(v.id("opportunities")),
    publishedBy: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
  }).index("by_reviewStatus", ["reviewStatus"]),
  profiles: defineTable({
    ownerKey: v.string(),
    firstName: v.optional(v.string()),
    state: v.optional(v.string()),
    sector: v.optional(v.string()),
    businessStage: v.optional(v.string()),
    cac: v.optional(v.string()),
    staffSize: v.optional(v.number()),
    age: v.optional(v.string()),
    womenLed: v.optional(v.boolean()),
    needs: v.optional(v.array(v.string())),
    reminderDays: v.optional(v.array(v.number())),
    lowData: v.optional(v.boolean()),
    language: v.optional(v.string()),
    email: v.optional(v.string()),
    planUpdatesOptIn: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerKey"]),
  applicationDrafts: defineTable({
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    questionKey: v.union(
      v.literal("business-summary"),
      v.literal("eligibility-statement"),
      v.literal("document-cover"),
    ),
    generatedText: v.string(),
    editedText: v.optional(v.string()),
    traces: v.array(v.object({ statement: v.string(), source: v.string() })),
    gaps: v.array(v.string()),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_owner_opportunity", ["ownerKey", "opportunityId"]),
  adviserInvites: defineTable({
    code: v.string(),
    entrepreneurKey: v.string(),
    label: v.string(),
    scopes: v.array(v.string()),
    opportunityIds: v.array(v.string()),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("expired")),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_entrepreneur", ["entrepreneurKey"]),
  adviserGrants: defineTable({
    entrepreneurKey: v.string(),
    adviserKey: v.string(),
    label: v.string(),
    scopes: v.array(v.string()),
    opportunityIds: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("revoked")),
    audit: v.array(
      v.object({
        at: v.number(),
        actorKey: v.string(),
        action: v.string(),
        detail: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_entrepreneur", ["entrepreneurKey"])
    .index("by_adviser", ["adviserKey"]),
  planMessages: defineTable({
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    messageHash: v.string(),
    channel: v.union(v.literal("email"), v.literal("sms")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    overall: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_owner_opp", ["ownerKey", "opportunityId"]),
  providers: defineTable({
    name: v.string(),
    type: v.string(),
    verified: v.boolean(),
    contact: v.optional(v.string()),
    officialLink: v.optional(v.string()),
    authorizedEmails: v.optional(v.array(v.string())),
  }).index("by_name", ["name"]),
  chatThreads: defineTable({
    opportunityId: v.id("opportunities"),
    deviceId: v.string(),
    threadId: v.string(),
    title: v.string(),
    updatedAt: v.number(),
  }).index("by_device", ["deviceId"]),
  userDocuments: defineTable({
    ownerKey: v.string(),
    opportunityId: v.optional(v.id("opportunities")),
    criterionKey: v.optional(v.string()),
    docType: v.union(
      v.literal("cac-certificate"),
      v.literal("id-card"),
      v.literal("bank-statement"),
      v.literal("business-plan"),
      v.literal("other"),
    ),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    content: v.bytes(),
    verification: v.union(v.literal("unverified"), v.literal("accepted"), v.literal("expired")),
    verificationNote: v.optional(v.string()),
    verifiedBy: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_owner_type", ["ownerKey", "docType"]),
  answerLedger: defineTable({
    ownerKey: v.string(),
    profileField: v.string(),
    value: v.string(),
    valueType: v.union(v.literal("string"), v.literal("number"), v.literal("boolean")),
    source: v.string(),
    sourceOpportunityId: v.optional(v.id("opportunities")),
    confirmedAt: v.number(),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_owner_field", ["ownerKey", "profileField"]),
  answerOverrides: defineTable({
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    profileField: v.string(),
    value: v.string(),
    valueType: v.union(v.literal("string"), v.literal("number"), v.literal("boolean")),
    updatedAt: v.number(),
  }).index("by_owner_opportunity", ["ownerKey", "opportunityId"]),
  linkSuggestions: defineTable({
    url: v.string(),
    normalizedUrl: v.string(),
    deviceId: v.optional(v.string()),
    createdAt: v.number(),
    status: v.union(v.literal("suggested"), v.literal("imported"), v.literal("declined")),
    draftId: v.optional(v.id("importDrafts")),
  })
    .index("by_status", ["status"])
    .index("by_normalizedUrl", ["normalizedUrl"]),
  successStories: defineTable({
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    story: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_owner", ["ownerKey"]),
  planOutcomes: defineTable({
    ownerKey: v.string(),
    opportunityId: v.id("opportunities"),
    outcome: v.union(
      v.literal("submitted"),
      v.literal("shortlisted"),
      v.literal("rejected"),
      v.literal("funded"),
      v.literal("abandoned"),
    ),
    reasonCode: v.optional(v.string()),
    reasonOther: v.optional(v.string()),
    reportedBy: v.union(v.literal("user"), v.literal("provider")),
    includeInLearning: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_owner_opp", ["ownerKey", "opportunityId"]),
  entityLinks: defineTable({
    kind: v.union(v.literal("provider"), v.literal("program")),
    fromId: v.string(),
    toId: v.string(),
    relation: v.union(v.literal("same"), v.literal("related"), v.literal("cohort")),
    cohortLabel: v.optional(v.string()),
    note: v.optional(v.string()),
    decidedBy: v.string(),
    decidedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("reverted")),
  }).index("by_status", ["status"]),
});
