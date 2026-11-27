import {
  BUSINESS_REVIEW_ACTIONS,
  BUSINESS_STATUSES,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_KINDS,
  DOCUMENT_MAX_BYTES,
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  MEDIA_PURPOSES,
  ONBOARDING_ITEMS,
} from '@jays/domain';
import { z } from 'zod';
import { businessModeStatusSchema } from './business.js';
import { emirateCodeSchema, isoDateTime, modeSchema } from './identity.js';

/**
 * Merchant onboarding, verification documents, media and storefront (docs/03-business.md).
 * Request schemas are strict: status, review and approval fields can never be sent by a merchant.
 */

export const localizedInputSchema = (min: number, max: number) =>
  z.strictObject({
    en: z.string().trim().min(min).max(max),
    ar: z.string().trim().min(min).max(max),
  });
const localized = z.object({ en: z.string(), ar: z.string() });

export const businessStatusSchema = z.enum(BUSINESS_STATUSES);
export const isoDate = z.iso.date();

export const businessAddressInputSchema = z.strictObject({
  emirate: emirateCodeSchema,
  area: z.string().trim().min(1).max(120),
  street: z.string().trim().min(1).max(160),
  building: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(40).nullable().optional(),
});

/** Partial update of the legal profile. Allowed while the business is a draft or was rejected. */
export const updateOnboardingRequestSchema = z.strictObject({
  legalName: z.string().trim().min(2).max(200).optional(),
  tradeLicenseNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9/-]{2,39}$/, 'letters, digits, / and - only (3–40)')
    .optional(),
  licenseAuthority: z.string().trim().min(2).max(120).optional(),
  licenseExpiry: isoDate.optional(),
  taxRegistered: z.boolean().optional(),
  /** UAE tax registration number (15 digits); null clears it. */
  taxId: z
    .string()
    .trim()
    .regex(/^[0-9]{15}$/, 'must be 15 digits')
    .nullable()
    .optional(),
  address: businessAddressInputSchema.optional(),
});
export type UpdateOnboardingRequest = z.infer<typeof updateOnboardingRequestSchema>;

export const acceptAgreementRequestSchema = z.strictObject({
  /** Must equal the current agreement version shown in the onboarding view. */
  version: z.string().min(1).max(64),
});

export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export const uploadRejectionSchema = z.enum([
  'type_mismatch',
  'too_large',
  'empty',
  'malware',
  'dimensions',
]);

export const createDocumentUploadRequestSchema = z.strictObject({
  kind: documentKindSchema,
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(DOCUMENT_MAX_BYTES),
});

export const documentSchema = z.object({
  id: z.uuid(),
  kind: documentKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nullable(),
  status: z.enum(['pending_upload', 'clean', 'infected', 'rejected']),
  rejectionReason: uploadRejectionSchema.nullable(),
  uploadedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type DocumentView = z.infer<typeof documentSchema>;

/** A one-time, short-lived signed upload. PUT the file to `uploadUrl` with `headers`, then call complete. */
export const uploadTicketSchema = z.object({
  id: z.uuid(),
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  maxBytes: z.number().int(),
  expiresAt: isoDateTime,
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const signedUrlSchema = z.object({ url: z.url(), expiresAt: isoDateTime });

export const mediaPurposeSchema = z.enum(MEDIA_PURPOSES);
export const createMediaUploadRequestSchema = z.strictObject({
  purpose: mediaPurposeSchema,
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(IMAGE_MAX_BYTES),
});

export const mediaSchema = z.object({
  id: z.uuid(),
  purpose: mediaPurposeSchema,
  contentType: z.string(),
  status: z.enum(['pending_upload', 'ready', 'rejected']),
  rejectionReason: uploadRejectionSchema.nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Short-lived signed URL for previews in the portal; null until the image is ready. */
  previewUrl: z.url().nullable(),
});
export type MediaView = z.infer<typeof mediaSchema>;

export const updateStorefrontRequestSchema = z.strictObject({
  name: localizedInputSchema(2, 80).optional(),
  description: localizedInputSchema(20, 2000).optional(),
  /** A ready image of this business with the matching purpose; null removes it. */
  logoMediaId: z.uuid().nullable().optional(),
  bannerMediaId: z.uuid().nullable().optional(),
});
export type UpdateStorefrontRequest = z.infer<typeof updateStorefrontRequestSchema>;

const storefrontContentSchema = z.object({
  name: localized.nullable(),
  description: localized.nullable(),
  logo: mediaSchema.nullable(),
  banner: mediaSchema.nullable(),
});

export const storefrontSchema = z.object({
  /** What the merchant is editing. */
  draft: storefrontContentSchema,
  /** What customers see; null until first approval. */
  live: storefrontContentSchema.nullable(),
  publishedAt: isoDateTime.nullable(),
  /** After approval, edits wait for review; the live version stays public meanwhile. */
  changesPending: z.boolean(),
  changesReviewReason: z.string().nullable(),
});
export type StorefrontView = z.infer<typeof storefrontSchema>;

export const modeReviewSchema = z.object({
  status: businessModeStatusSchema,
  reviewReason: z.string().nullable(),
  submittedAt: isoDateTime.nullable(),
  reviewedAt: isoDateTime.nullable(),
});

export const checklistItemSchema = z.object({ item: z.enum(ONBOARDING_ITEMS), done: z.boolean() });

export const legalProfileSchema = z.object({
  legalName: z.string().nullable(),
  tradeLicenseNumber: z.string().nullable(),
  licenseAuthority: z.string().nullable(),
  licenseExpiry: isoDate.nullable(),
  taxRegistered: z.boolean(),
  taxId: z.string().nullable(),
  address: z.object({
    emirate: emirateCodeSchema.nullable(),
    area: z.string().nullable(),
    street: z.string().nullable(),
    building: z.string().nullable(),
    unit: z.string().nullable(),
  }),
});

export const onboardingSchema = z.object({
  businessId: z.uuid(),
  displayName: localized,
  status: businessStatusSchema,
  /** Feedback from the last review (rejection reason), shown when resubmitting. */
  reviewReason: z.string().nullable(),
  suspensionReason: z.string().nullable(),
  submittedAt: isoDateTime.nullable(),
  reviewedAt: isoDateTime.nullable(),
  legal: legalProfileSchema,
  agreement: z.object({
    currentVersion: z.string(),
    acceptedVersion: z.string().nullable(),
    acceptedAt: isoDateTime.nullable(),
  }),
  documents: z.array(documentSchema),
  storefront: storefrontSchema,
  modes: z.object({ shop: modeReviewSchema, services: modeReviewSchema }),
  checklist: z.array(checklistItemSchema),
  /** Legal profile and documents can be changed (draft or rejected). */
  editable: z.boolean(),
  /** Everything required is done and there is something to submit. */
  canSubmit: z.boolean(),
});
export type OnboardingView = z.infer<typeof onboardingSchema>;

// ---------------------------------------------------------------------------------------------
// Admin review

export const adminBusinessListQuerySchema = z.strictObject({
  /** `pending` (default): anything waiting for a decision, including new modes and storefront changes. */
  status: z
    .union([z.literal('pending'), z.literal('all'), businessStatusSchema])
    .default('pending'),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminBusinessListQuery = z.infer<typeof adminBusinessListQuerySchema>;

export const adminBusinessListItemSchema = z.object({
  id: z.uuid(),
  displayName: localized,
  legalName: z.string().nullable(),
  status: businessStatusSchema,
  modes: z.object({ shop: businessModeStatusSchema, services: businessModeStatusSchema }),
  storefrontChangesPending: z.boolean(),
  submittedAt: isoDateTime.nullable(),
  version: z.number().int(),
  createdAt: isoDateTime,
});
export type AdminBusinessListItem = z.infer<typeof adminBusinessListItemSchema>;

export const businessHistoryItemSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actorType: z.enum(['user', 'admin', 'system']),
  reason: z.string().nullable(),
  diff: z.unknown().nullable(),
  createdAt: isoDateTime,
});

export const adminBusinessDetailSchema = adminBusinessListItemSchema.extend({
  reviewReason: z.string().nullable(),
  suspensionReason: z.string().nullable(),
  reviewedAt: isoDateTime.nullable(),
  legal: legalProfileSchema,
  /** Licence expiry is today or later (UAE date). */
  licenseValid: z.boolean(),
  agreement: z.object({
    acceptedVersion: z.string().nullable(),
    acceptedAt: isoDateTime.nullable(),
  }),
  owner: z.object({ displayName: z.string().nullable(), contact: z.string() }).nullable(),
  documents: z.array(documentSchema),
  storefront: storefrontSchema,
  modeReviews: z.object({ shop: modeReviewSchema, services: modeReviewSchema }),
  checklist: z.array(checklistItemSchema),
  history: z.array(businessHistoryItemSchema),
});
export type AdminBusinessDetail = z.infer<typeof adminBusinessDetailSchema>;

const reason = z.string().trim().min(5).max(1000);
const expectedVersion = z.number().int().min(1);

/**
 * Typed action allowlist with a version precondition (docs/07-api.md). A stale `expectedVersion`
 * answers 409 VERSION_CONFLICT, so two reviewers cannot act on different versions.
 */
export const businessActionRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('start_review'),
    expectedVersion,
    reason: reason.optional(),
  }),
  z.strictObject({
    action: z.literal('approve'),
    expectedVersion,
    /** Modes to approve; pending modes not listed are rejected with `reason`. Default: all pending. */
    modes: z.array(modeSchema).min(1).max(2).optional(),
    reason: reason.optional(),
  }),
  z.strictObject({ action: z.literal('reject'), expectedVersion, reason }),
  z.strictObject({
    action: z.literal('approve_mode'),
    expectedVersion,
    mode: modeSchema,
    reason: reason.optional(),
  }),
  z.strictObject({ action: z.literal('reject_mode'), expectedVersion, mode: modeSchema, reason }),
  z.strictObject({ action: z.literal('suspend'), expectedVersion, reason }),
  z.strictObject({ action: z.literal('reactivate'), expectedVersion, reason }),
  z.strictObject({
    action: z.literal('approve_storefront_changes'),
    expectedVersion,
    reason: reason.optional(),
  }),
  z.strictObject({ action: z.literal('reject_storefront_changes'), expectedVersion, reason }),
]);
export type BusinessActionRequest = z.infer<typeof businessActionRequestSchema>;
export const businessReviewActionSchema = z.enum(BUSINESS_REVIEW_ACTIONS);
