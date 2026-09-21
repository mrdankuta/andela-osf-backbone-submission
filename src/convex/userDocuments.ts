import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { effectiveOwnerKey } from "./identity";
import { requireCurator, reviewerIdentity } from "./curation";

// Private document storage for one readiness requirement (issue #51).
//
// Files stay small (256 KB cap) and live as bytes on the owner's private
// rows — served only through authenticated reads, never public URLs.
// Having a file is not the same as satisfying a provider: documents sit in
// unverified until a curator accepts them, and expiry is computed, not
// claimed. Replacement resets verification; deletion follows the user's
// data lifecycle (see dataControls, which also sweeps these rows).

export const MAX_DOC_BYTES = 256 * 1024;

export const ALLOWED_DOC_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;

export const DOC_TYPES = [
  "cac-certificate",
  "id-card",
  "bank-statement",
  "business-plan",
  "other",
] as const;

export type DocumentState = "missing" | "present-unverified" | "accepted" | "expired";

const docType = v.union(
  v.literal("cac-certificate"),
  v.literal("id-card"),
  v.literal("bank-statement"),
  v.literal("business-plan"),
  v.literal("other"),
);

export function documentState(
  doc:
    | { verification: string; expiresAt?: number; updatedAt: number }
    | null
    | undefined,
  now: number,
): DocumentState {
  if (!doc) return "missing";
  if (doc.expiresAt !== undefined && doc.expiresAt < now) return "expired";
  if (doc.verification === "accepted") return "accepted";
  return "present-unverified";
}

async function ownerDocs(ctx: QueryCtx | MutationCtx, ownerKey: string) {
  return await ctx.db
    .query("userDocuments")
    .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
    .take(50);
}

export const uploadDocument = mutation({
  args: {
    ownerKey: v.string(),
    opportunityId: v.optional(v.id("opportunities")),
    criterionKey: v.optional(v.string()),
    docType,
    fileName: v.string(),
    mimeType: v.string(),
    content: v.bytes(),
  },
  returns: v.object({ documentId: v.string(), replaced: v.boolean(), state: v.string() }),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    if (!(ALLOWED_DOC_MIME as readonly string[]).includes(args.mimeType)) {
      throw new Error("Only PDF, JPEG, or PNG files are supported.");
    }
    const sizeBytes = args.content.byteLength;
    if (sizeBytes === 0) throw new Error("The file is empty.");
    if (sizeBytes > MAX_DOC_BYTES) {
      throw new Error(`Files are capped at ${MAX_DOC_BYTES / 1024} KB for the PoC.`);
    }
    if (!args.fileName.trim()) throw new Error("A file name is required.");
    if (args.opportunityId) {
      const opp = await ctx.db.get("opportunities", args.opportunityId);
      if (!opp) throw new Error("Opportunity not found.");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("userDocuments")
      .withIndex("by_owner_type", (q) => q.eq("ownerKey", ownerKey).eq("docType", args.docType))
      .take(10);
    const sameContext = existing.find(
      (d) =>
        (d.opportunityId ?? null) === (args.opportunityId ?? null) &&
        (d.criterionKey ?? null) === (args.criterionKey ?? null),
    );
    if (sameContext) {
      // Replacement resets verification: a new file must be re-checked.
      await ctx.db.patch("userDocuments", sameContext._id, {
        fileName: args.fileName.trim(),
        mimeType: args.mimeType,
        sizeBytes,
        content: args.content,
        verification: "unverified",
        verificationNote: undefined,
        verifiedBy: undefined,
        verifiedAt: undefined,
        expiresAt: undefined,
        updatedAt: now,
      });
      return { documentId: sameContext._id, replaced: true, state: "present-unverified" };
    }
    const documentId = await ctx.db.insert("userDocuments", {
      ownerKey,
      opportunityId: args.opportunityId,
      criterionKey: args.criterionKey?.trim() || undefined,
      docType: args.docType,
      fileName: args.fileName.trim(),
      mimeType: args.mimeType,
      sizeBytes,
      content: args.content,
      verification: "unverified",
      createdAt: now,
      updatedAt: now,
    });
    return { documentId, replaced: false, state: "present-unverified" };
  },
});

export const getDocument = query({
  args: { ownerKey: v.string(), documentId: v.id("userDocuments") },
  returns: v.union(
    v.object({
      fileName: v.string(),
      mimeType: v.string(),
      sizeBytes: v.number(),
      content: v.bytes(),
      docType: v.string(),
      verification: v.string(),
      state: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const doc = await ctx.db.get("userDocuments", args.documentId);
    if (!doc || doc.ownerKey !== ownerKey) return null;
    return {
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      content: doc.content,
      docType: doc.docType,
      verification: doc.verification,
      state: documentState(doc, Date.now()),
    };
  },
});

export const listDocuments = query({
  args: { ownerKey: v.string(), opportunityId: v.optional(v.id("opportunities")) },
  returns: v.array(
    v.object({
      _id: v.id("userDocuments"),
      fileName: v.string(),
      mimeType: v.string(),
      sizeBytes: v.number(),
      docType: v.string(),
      criterionKey: v.optional(v.string()),
      state: v.string(),
      verificationNote: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const docs = await ownerDocs(ctx, ownerKey);
    const now = Date.now();
    return docs
      .filter((d) => !args.opportunityId || !d.opportunityId || d.opportunityId === args.opportunityId)
      .map((d) => ({
        _id: d._id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        docType: d.docType,
        criterionKey: d.criterionKey,
        state: documentState(d, now),
        verificationNote: d.verificationNote,
        expiresAt: d.expiresAt,
        updatedAt: d.updatedAt,
      }));
  },
});

export const deleteDocument = mutation({
  args: { ownerKey: v.string(), documentId: v.id("userDocuments") },
  returns: v.union(v.literal(true), v.null()),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const doc = await ctx.db.get("userDocuments", args.documentId);
    if (!doc || doc.ownerKey !== ownerKey) return null;
    await ctx.db.delete("userDocuments", args.documentId);
    return true as const;
  },
});

export const verifyDocument = mutation({
  args: {
    documentId: v.id("userDocuments"),
    accepted: v.boolean(),
    note: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.literal(true),
  handler: async (ctx, args) => {
    await requireCurator(ctx);
    const doc = await ctx.db.get("userDocuments", args.documentId);
    if (!doc) throw new Error("Document not found.");
    const reviewer = await reviewerIdentity(ctx);
    await ctx.db.patch("userDocuments", args.documentId, {
      verification: args.accepted ? "accepted" : "unverified",
      verificationNote: args.note?.trim()
        ? `${args.note.trim()} (reviewed by ${reviewer})`
        : `Reviewed by ${reviewer}.`,
      verifiedBy: reviewer,
      verifiedAt: Date.now(),
      expiresAt: args.expiresAt,
      updatedAt: Date.now(),
    });
    return true as const;
  },
});

export const documentReadiness = query({
  args: { ownerKey: v.string(), opportunityId: v.id("opportunities") },
  returns: v.array(
    v.object({
      criterionKey: v.string(),
      label: v.string(),
      state: v.string(),
      documentId: v.union(v.id("userDocuments"), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerKey = await effectiveOwnerKey(ctx, args.ownerKey);
    const criteria = await ctx.db
      .query("readinessCriteria")
      .withIndex("by_opportunityId", (q) => q.eq("opportunityId", args.opportunityId))
      .take(50);
    const docs = await ownerDocs(ctx, ownerKey);
    const now = Date.now();
    const out = [];
    for (const c of criteria) {
      if ((c.family ?? "") !== "documents" || !c.documentType) continue;
      const doc = docs.find((d) => d.docType === c.documentType);
      out.push({
        criterionKey: c.criterionKey,
        label: c.label,
        state: documentState(doc ?? null, now),
        documentId: doc?._id ?? null,
      });
    }
    return out;
  },
});

export const pendingDocuments = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("userDocuments"),
      fileName: v.string(),
      mimeType: v.string(),
      sizeBytes: v.number(),
      docType: v.string(),
      criterionKey: v.optional(v.string()),
      opportunityId: v.optional(v.id("opportunities")),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireCurator(ctx);
    const docs = await ctx.db.query("userDocuments").take(100);
    return docs
      .filter((d) => d.verification === "unverified")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((d) => ({
        _id: d._id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        docType: d.docType,
        criterionKey: d.criterionKey,
        opportunityId: d.opportunityId,
        createdAt: d.createdAt,
      }));
  },
});
