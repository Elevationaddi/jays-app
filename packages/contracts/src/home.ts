import { HOME_SERVICE_STATUSES, normalizeArea } from '@jays/domain';
import { z } from 'zod';
import { emirateCodeSchema, isoDateTime } from './identity.js';

/**
 * Home services (ADR-0018 D9, ADR-0022): the business's licence and coverage, and the admin
 * review that enables home visits. Money is integer fils.
 */

const localized = z.object({ en: z.string(), ar: z.string() });
const cursorQuery = {
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const homeServiceStatusSchema = z.enum(HOME_SERVICE_STATUSES);

const areaInputSchema = z.strictObject({
  emirate: emirateCodeSchema,
  /** Omit or null to cover the whole emirate. */
  area: z.string().trim().min(1).max(120).nullable().optional(),
  travelFeeFils: z.number().int().min(0).max(10_000_000),
});

export const homeServiceProfileInputSchema = z.strictObject({
  licenseNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9/-]{2,39}$/, 'letters, digits, / and -')
    .nullable()
    .optional(),
  licenseAuthority: z.string().trim().min(2).max(120).nullable().optional(),
  licenseExpiry: z.iso.date().nullable().optional(),
  /** A clean document of kind home_service_license. */
  licenseDocumentId: z.uuid().nullable().optional(),
  travelBufferMin: z
    .number()
    .int()
    .min(0)
    .max(120)
    .refine((m) => m % 5 === 0, 'a multiple of 5 minutes'),
  minOrderFils: z.number().int().min(0).max(100_000_000),
  areas: z
    .array(areaInputSchema)
    .max(100)
    .refine(
      (list) =>
        new Set(list.map((a) => `${a.emirate}|${a.area ? normalizeArea(a.area) : ''}`)).size ===
        list.length,
      'each area once',
    ),
});
export type HomeServiceProfileInput = z.infer<typeof homeServiceProfileInputSchema>;

const profileFields = {
  businessId: z.uuid(),
  status: homeServiceStatusSchema,
  licenseNumber: z.string().nullable(),
  licenseAuthority: z.string().nullable(),
  licenseExpiry: z.iso.date().nullable(),
  licenseDocument: z.object({ id: z.uuid(), fileName: z.string(), status: z.string() }).nullable(),
  travelBufferMin: z.number().int(),
  minOrderFils: z.number().int(),
  submittedAt: isoDateTime.nullable(),
  reviewedAt: isoDateTime.nullable(),
  reviewReason: z.string().nullable(),
  version: z.number().int(),
  areas: z.array(
    z.object({
      id: z.uuid(),
      emirate: emirateCodeSchema,
      area: z.string().nullable(),
      travelFeeFils: z.number().int(),
    }),
  ),
  /** Licence details may change only while the profile is a draft or was rejected. */
  licenseEditable: z.boolean(),
  /** Whether customers can book home visits now: approved and the licence not expired. */
  active: z.boolean(),
};

export const homeServiceProfileSchema = z.object(profileFields);
export type HomeServiceProfile = z.infer<typeof homeServiceProfileSchema>;

export const adminHomeServiceListQuerySchema = z.strictObject({
  status: homeServiceStatusSchema.optional(),
  ...cursorQuery,
});
export type AdminHomeServiceListQuery = z.infer<typeof adminHomeServiceListQuerySchema>;

export const adminHomeServiceSchema = z.object({
  ...profileFields,
  business: z.object({ id: z.uuid(), name: localized }),
});
export type AdminHomeService = z.infer<typeof adminHomeServiceSchema>;

export const homeServiceDecisionRequestSchema = z
  .strictObject({
    decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']),
    reason: z.string().trim().min(3).max(1000).nullable().optional(),
    expectedVersion: z.number().int().min(1),
  })
  .refine((d) => d.decision === 'approve' || d.decision === 'reinstate' || !!d.reason, {
    message: 'required to reject or suspend',
    path: ['reason'],
  });
export type HomeServiceDecisionRequest = z.infer<typeof homeServiceDecisionRequestSchema>;
