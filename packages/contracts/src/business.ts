import { BUSINESS_CAPABILITIES, BUSINESS_PERMISSIONS } from '@jays/domain';
import { z } from 'zod';
import { emailSchema, isoDateTime, modeSchema, phoneSchema } from './identity.js';

export const businessPermissionSchema = z.enum(BUSINESS_PERMISSIONS);
export const businessCapabilitySchema = z.enum(BUSINESS_CAPABILITIES);

const localizedName = z.strictObject({
  en: z.string().trim().min(2).max(120),
  ar: z.string().trim().min(2).max(120),
});

export const createBusinessRequestSchema = z.strictObject({
  displayName: localizedName,
  /** Modes to start onboarding for. More can be activated later. */
  modes: z
    .array(modeSchema)
    .min(1)
    .max(2)
    .refine((modes) => new Set(modes).size === modes.length, 'modes must be unique'),
});
export type CreateBusinessRequest = z.infer<typeof createBusinessRequestSchema>;

export const businessModeStatusSchema = z.enum([
  'not_activated',
  'onboarding',
  'pending_review',
  'active',
  'rejected',
  'suspended',
]);
export type BusinessModeStatus = z.infer<typeof businessModeStatusSchema>;

export const businessSchema = z.object({
  id: z.uuid(),
  displayName: z.object({ en: z.string(), ar: z.string() }),
  status: z.enum(['draft', 'submitted', 'under_review', 'approved', 'rejected', 'suspended']),
  /** Both modes are always listed; `not_activated` means the gateway shows onboarding. */
  modes: z.object({ shop: businessModeStatusSchema, services: businessModeStatusSchema }),
  myPermissions: z.array(businessPermissionSchema),
  myCapabilities: z.array(businessCapabilitySchema),
  createdAt: isoDateTime,
});
export type BusinessView = z.infer<typeof businessSchema>;

export const myMembershipSchema = z.object({
  membershipId: z.uuid(),
  status: z.enum(['invited', 'active']),
  permissions: z.array(businessPermissionSchema),
  business: businessSchema,
});
export type MyMembership = z.infer<typeof myMembershipSchema>;

export const inviteMemberRequestSchema = z.strictObject({
  /** Email or phone of an existing, verified account. */
  identifier: z.union([emailSchema, phoneSchema]),
  permissions: z
    .array(businessPermissionSchema)
    .min(1)
    .refine((p) => new Set(p).size === p.length, 'permissions must be unique'),
});

export const updateMemberRequestSchema = z.strictObject({
  permissions: z
    .array(businessPermissionSchema)
    .min(1)
    .refine((p) => new Set(p).size === p.length, 'permissions must be unique'),
});

export const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().nullable(),
  /** Masked contact so staff lists do not expose full personal data. */
  contact: z.string(),
  permissions: z.array(businessPermissionSchema),
  status: z.enum(['invited', 'active']),
  invitedAt: isoDateTime,
  acceptedAt: isoDateTime.nullable(),
});
export type Member = z.infer<typeof memberSchema>;
