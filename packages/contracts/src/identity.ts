import { EMIRATE_CODES, MODES } from '@jays/domain';
import { z } from 'zod';

/**
 * Identity wire contracts (docs/07-api.md: /auth, /me). Request schemas are strict: unknown keys
 * such as `role` or `permissions` are rejected, so a client can never claim a role.
 */

export const OTP_LENGTH = 6;

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{7,14}$/, 'must be an international number such as +971501234567');
// Length-based policy (NIST SP 800-63B). Breached-password screening is a phase 7 item.
export const passwordSchema = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(128, 'must be at most 128 characters');
export const localeSchema = z.enum(['en', 'ar']);
export const modeSchema = z.enum(MODES);
export const emirateCodeSchema = z.enum(EMIRATE_CODES);
export const otpCodeSchema = z.string().regex(/^[0-9]{6}$/, 'must be 6 digits');
export const isoDateTime = z.iso.datetime({ offset: true });

export const registerRequestSchema = z
  .strictObject({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    locale: localeSchema.default('en'),
    acceptTerms: z.literal(true, 'you must accept the terms'),
    marketingConsent: z.boolean().default(false),
  })
  .refine((body) => (body.email === undefined) !== (body.phone === undefined), {
    message: 'provide either an email address or a phone number',
    path: ['email'],
  });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const challengeSchema = z.object({
  challengeId: z.uuid(),
  channel: z.enum(['email', 'sms']),
  /** Masked destination, e.g. "n***@example.test" or "+97150*****67". */
  destination: z.string(),
  expiresAt: isoDateTime,
  resendAvailableAt: isoDateTime,
});
export type Challenge = z.infer<typeof challengeSchema>;

export const verifyRequestSchema = z.strictObject({ challengeId: z.uuid(), code: otpCodeSchema });
export const resendRequestSchema = z.strictObject({ challengeId: z.uuid() });

export const loginRequestSchema = z.strictObject({
  /** Email address or international phone number. */
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
});

export const refreshRequestSchema = z.strictObject({ refreshToken: z.string().min(20).max(512) });
export const logoutRequestSchema = refreshRequestSchema;

export const passwordResetRequestSchema = z.strictObject({
  identifier: z.string().trim().min(3).max(254),
});
export const passwordResetConfirmSchema = z.strictObject({
  challengeId: z.uuid(),
  code: otpCodeSchema,
  newPassword: passwordSchema,
});

export const tokenPairSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTime,
  refreshToken: z.string(),
  refreshTokenExpiresAt: isoDateTime,
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const meSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  status: z.enum(['pending_verification', 'active', 'restricted', 'deactivated']),
  displayName: z.string().nullable(),
  locale: localeSchema,
  emirate: emirateCodeSchema.nullable(),
  preferredMode: modeSchema.nullable(),
  marketingConsent: z.boolean(),
  /** True when the user has at least one active business membership. */
  hasBusinessMembership: z.boolean(),
  createdAt: isoDateTime,
});
export type Me = z.infer<typeof meSchema>;

export const sessionSchema = z.object({ tokens: tokenPairSchema, user: meSchema });
export type Session = z.infer<typeof sessionSchema>;

export const updateMeRequestSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80).nullable(),
    locale: localeSchema,
    emirate: emirateCodeSchema.nullable(),
    preferredMode: modeSchema.nullable(),
    marketingConsent: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'provide at least one field');
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const addressInputSchema = z
  .strictObject({
    label: trimmed(1, 40).nullable().optional(),
    emirate: emirateCodeSchema,
    area: trimmed(1, 120),
    street: trimmed(1, 160),
    building: trimmed(1, 120),
    unit: trimmed(1, 40).nullable().optional(),
    directions: z.string().max(500).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((a) => ((a.latitude ?? null) === null) === ((a.longitude ?? null) === null), {
    message: 'latitude and longitude go together',
    path: ['latitude'],
  });
export type AddressInput = z.infer<typeof addressInputSchema>;

export const addressPatchSchema = z
  .strictObject({
    label: trimmed(1, 40).nullable(),
    emirate: emirateCodeSchema,
    area: trimmed(1, 120),
    street: trimmed(1, 160),
    building: trimmed(1, 120),
    unit: trimmed(1, 40).nullable(),
    directions: z.string().max(500).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    isDefault: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'provide at least one field');

export const addressSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  emirate: emirateCodeSchema,
  area: z.string(),
  street: z.string(),
  building: z.string(),
  unit: z.string().nullable(),
  directions: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  isDefault: z.boolean(),
  createdAt: isoDateTime,
});
export type Address = z.infer<typeof addressSchema>;

export const localizedTextSchema = z.object({ en: z.string(), ar: z.string() });

export const emirateSchema = z.object({ code: emirateCodeSchema, name: localizedTextSchema });
export type Emirate = z.infer<typeof emirateSchema>;
export const emirateListSchema = z.object({ items: z.array(emirateSchema) });
