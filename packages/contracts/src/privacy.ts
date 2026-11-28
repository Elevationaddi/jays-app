import { z } from 'zod';
import { isoDateTime, localeSchema } from './identity.js';

/** Account and privacy (ADR-0018 D14 and D15; ADR-0019). */

export const channelFlagsSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  push: z.boolean(),
});
export type ChannelFlags = z.infer<typeof channelFlagsSchema>;

export const consentPurposeSchema = z.enum(['marketing_email', 'marketing_sms', 'marketing_push']);
export const consentSourceSchema = z.enum([
  'signup',
  'settings',
  'unsubscribe_link',
  'account_deletion',
  'migration',
]);

export const consentRecordSchema = z.object({
  id: z.uuid(),
  purpose: consentPurposeSchema,
  granted: z.boolean(),
  source: consentSourceSchema,
  locale: localeSchema,
  policyVersion: z.string(),
  createdAt: isoDateTime,
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const deletionReasonCodeSchema = z.enum([
  'business_member',
  'open_orders',
  'upcoming_bookings',
  'open_returns',
]);

export const accountDeletionSchema = z.object({
  id: z.uuid(),
  status: z.enum(['pending', 'canceled', 'completed']),
  requestedAt: isoDateTime,
  scheduledFor: isoDateTime,
  /** Set when the deletion was put off because something was still open. */
  postponedReason: deletionReasonCodeSchema.nullable(),
});
export type AccountDeletion = z.infer<typeof accountDeletionSchema>;

export const privacySchema = z.object({
  /** Marketing, opt-in per channel. Never required to use the app. */
  marketing: channelFlagsSchema,
  /**
   * Order, booking and support updates outside the app. In-app notifications and security
   * messages (verification codes, password resets) are always sent.
   */
  notifications: channelFlagsSchema,
  /** The marketing wording version a new choice is recorded against (draft until legal sign-off). */
  marketingPolicyVersion: z.string(),
  /** Days between a deletion request and the anonymisation. */
  deletionGraceDays: z.number().int().positive(),
  deletion: accountDeletionSchema.nullable(),
});
export type Privacy = z.infer<typeof privacySchema>;

export const updatePrivacyRequestSchema = z
  .strictObject({
    marketing: channelFlagsSchema.partial(),
    notifications: channelFlagsSchema.partial(),
    /** The language the consent wording was shown in; defaults to the account language. */
    locale: localeSchema,
  })
  .partial()
  .refine(
    (b) => Object.keys(b.marketing ?? {}).length + Object.keys(b.notifications ?? {}).length > 0,
    'change at least one preference',
  );
export type UpdatePrivacyRequest = z.infer<typeof updatePrivacyRequestSchema>;

export const requestDeletionSchema = z.strictObject({
  /** The current password, so a stolen session alone cannot delete the account. */
  password: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export const unsubscribeChannelSchema = z.enum(['email', 'sms', 'push', 'all']);
export const unsubscribeResultSchema = z.object({
  channel: unsubscribeChannelSchema,
  /** True once the withdrawal is recorded (always false for a preview). */
  done: z.boolean(),
});
export type UnsubscribeResult = z.infer<typeof unsubscribeResultSchema>;

/** Everything the account holds about the person, as a portable JSON document. */
export const dataExportSchema = z.object({
  generatedAt: isoDateTime,
  profile: z.record(z.string(), z.unknown()),
  privacy: privacySchema,
  consentHistory: z.array(consentRecordSchema),
  addresses: z.array(z.record(z.string(), z.unknown())),
  orders: z.array(z.record(z.string(), z.unknown())),
  bookings: z.array(z.record(z.string(), z.unknown())),
  reviews: z.array(z.record(z.string(), z.unknown())),
  tickets: z.array(z.record(z.string(), z.unknown())),
});
export type DataExport = z.infer<typeof dataExportSchema>;

/**
 * A device that receives push notifications (ADR-0031). The token comes from Firebase Cloud
 * Messaging on the device. Registering a token another account used moves it to this account.
 */
export const registerPushDeviceRequestSchema = z.object({
  token: z
    .string()
    .min(20)
    .max(4096)
    .regex(/^[A-Za-z0-9_:\-.]+$/, 'not a push token'),
  platform: z.enum(['ios', 'android', 'web']),
});
export type RegisterPushDeviceRequest = z.infer<typeof registerPushDeviceRequestSchema>;

export const unregisterPushDeviceRequestSchema = registerPushDeviceRequestSchema.pick({
  token: true,
});
export type UnregisterPushDeviceRequest = z.infer<typeof unregisterPushDeviceRequestSchema>;

export const pushDeviceSchema = z.object({
  id: z.uuid(),
  platform: z.enum(['ios', 'android', 'web']),
  createdAt: isoDateTime,
  lastSeenAt: isoDateTime,
});
export type PushDeviceView = z.infer<typeof pushDeviceSchema>;
export const pushDeviceListSchema = z.object({ items: z.array(pushDeviceSchema) });
