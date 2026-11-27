import { PLATFORM_CAPABILITIES, PLATFORM_ROLES } from '@jays/domain';
import { z } from 'zod';
import {
  emailSchema,
  isoDateTime,
  otpCodeSchema,
  passwordSchema,
  tokenPairSchema,
} from './identity.js';

export const platformRoleSchema = z.enum(PLATFORM_ROLES);

/** Destructive and security actions need a written reason (docs/04-admin.md). */
export const reasonSchema = z.string().trim().min(5).max(1000);

export const adminLoginRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
  /** TOTP code. Admin sign-in without MFA is impossible. */
  totpCode: otpCodeSchema,
});

export const adminSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  roles: z.array(platformRoleSchema),
  capabilities: z.array(z.enum(PLATFORM_CAPABILITIES)),
});
export type AdminView = z.infer<typeof adminSchema>;

export const adminSessionSchema = z.object({ tokens: tokenPairSchema, admin: adminSchema });
export type AdminSession = z.infer<typeof adminSessionSchema>;

export const acceptInviteRequestSchema = z.strictObject({
  token: z.string().min(20).max(256),
  password: passwordSchema,
});
export const mfaEnrollmentSchema = z.object({
  /** Base32 TOTP secret, shown once during enrolment. */
  secret: z.string(),
  otpauthUri: z.string(),
});
export const confirmMfaRequestSchema = z.strictObject({
  token: z.string().min(20).max(256),
  totpCode: otpCodeSchema,
});

export const createAdminInviteRequestSchema = z.strictObject({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
  roles: z
    .array(platformRoleSchema)
    .min(1)
    .refine((r) => new Set(r).size === r.length, 'roles must be unique'),
  reason: reasonSchema,
});
export const adminInviteSchema = z.object({
  adminId: z.uuid(),
  email: z.string(),
  status: z.literal('invited'),
  expiresAt: isoDateTime,
});

export const adminListItemSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: z.enum(['invited', 'active', 'suspended']),
  roles: z.array(platformRoleSchema),
  mfaEnabled: z.boolean(),
  createdAt: isoDateTime,
});
export type AdminListItem = z.infer<typeof adminListItemSchema>;

export const auditLogItemSchema = z.object({
  id: z.uuid(),
  actorType: z.enum(['user', 'admin', 'system']),
  actorId: z.uuid().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.uuid().nullable(),
  businessId: z.uuid().nullable(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDateTime,
});
export type AuditLogItem = z.infer<typeof auditLogItemSchema>;
