import { LEGAL_BODY_MAX, LEGAL_DOCUMENT_KINDS } from '@jays/domain';
import { z } from 'zod';
import { isoDateTime } from './identity.js';
import { localizedInputSchema } from './onboarding.js';

/**
 * Legal documents and acceptances (D13, phase 8.8; ADR-0028). Every document is a draft that a
 * UAE lawyer has not reviewed: `legalReview` is always "pending" until that review exists.
 */

const localized = z.object({ en: z.string(), ar: z.string() });

export const legalDocumentKindSchema = z.enum(LEGAL_DOCUMENT_KINDS);
export type LegalDocumentKindValue = z.infer<typeof legalDocumentKindSchema>;

const publicFields = {
  id: z.uuid(),
  kind: legalDocumentKindSchema,
  version: z.number().int(),
  title: localized,
  effectiveAt: isoDateTime,
  publishedAt: isoDateTime,
  /** No document has been reviewed by a lawyer yet (ADR-0028). */
  legalReview: z.literal('pending'),
};

export const legalDocumentSummarySchema = z.object(publicFields);
export const legalDocumentListSchema = z.object({ items: z.array(legalDocumentSummarySchema) });
export type LegalDocumentSummary = z.infer<typeof legalDocumentSummarySchema>;

export const legalDocumentSchema = z.object({ ...publicFields, body: localized });
export type LegalDocument = z.infer<typeof legalDocumentSchema>;

export const legalVersionRefSchema = z.strictObject({
  kind: legalDocumentKindSchema,
  version: z.number().int().min(1),
});

export const myLegalSchema = z.object({
  /** Required documents with a published version the user has not accepted yet. */
  pending: z.array(
    z.object({ kind: legalDocumentKindSchema, version: z.number().int(), title: localized }),
  ),
  accepted: z.array(
    z.object({
      kind: legalDocumentKindSchema,
      version: z.number().int(),
      acceptedAt: isoDateTime,
      current: z.boolean(),
    }),
  ),
});
export type MyLegal = z.infer<typeof myLegalSchema>;

export const acceptLegalRequestSchema = z.strictObject({
  documents: z.array(legalVersionRefSchema).min(1).max(12),
});
export type AcceptLegalRequest = z.infer<typeof acceptLegalRequestSchema>;

export const merchantAgreementSchema = z.object({
  document: legalDocumentSummarySchema.nullable(),
  accepted: z
    .object({ version: z.number().int(), acceptedAt: isoDateTime, acceptedBy: z.uuid() })
    .nullable(),
  /** True when a published agreement exists and this business has not accepted that version. */
  required: z.boolean(),
});
export type MerchantAgreementStatus = z.infer<typeof merchantAgreementSchema>;

export const acceptMerchantAgreementRequestSchema = z.strictObject({
  version: z.number().int().min(1),
});
export type AcceptMerchantAgreementRequest = z.infer<typeof acceptMerchantAgreementRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Admin

const body = localizedInputSchema(1, LEGAL_BODY_MAX);

export const createLegalDraftRequestSchema = z.strictObject({
  kind: legalDocumentKindSchema,
  title: localizedInputSchema(1, 200),
  body,
  summaryOfChanges: z.string().trim().max(1000).nullable().optional(),
});
export type CreateLegalDraftRequest = z.infer<typeof createLegalDraftRequestSchema>;

export const updateLegalDraftRequestSchema = z
  .strictObject({
    title: localizedInputSchema(1, 200).optional(),
    body: body.optional(),
    summaryOfChanges: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateLegalDraftRequest = z.infer<typeof updateLegalDraftRequestSchema>;

export const publishLegalRequestSchema = z.strictObject({
  /** When the version takes effect; now if omitted. Never in the past. */
  effectiveAt: isoDateTime.optional(),
});
export type PublishLegalRequest = z.infer<typeof publishLegalRequestSchema>;

export const adminLegalDocumentSchema = z.object({
  id: z.uuid(),
  kind: legalDocumentKindSchema,
  version: z.number().int(),
  title: localized,
  body: localized,
  summaryOfChanges: z.string().nullable(),
  status: z.enum(['draft', 'published', 'retired']),
  effectiveAt: isoDateTime.nullable(),
  publishedAt: isoDateTime.nullable(),
  retiredAt: isoDateTime.nullable(),
  legalReview: z.literal('pending'),
  acceptances: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AdminLegalDocument = z.infer<typeof adminLegalDocumentSchema>;
export const adminLegalListSchema = z.object({
  items: z.array(adminLegalDocumentSchema.omit({ body: true })),
});
