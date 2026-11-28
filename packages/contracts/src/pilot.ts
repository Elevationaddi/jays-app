import { z } from 'zod';
import { emirateCodeSchema, isoDateTime, localizedTextSchema } from './identity.js';

const promotionState = z.enum(['scheduled', 'active', 'ended', 'cancelled']);

/** A pilot merchant's 0% commission window (ADR-0034). */
export const pilotPromotionSchema = z.object({
  id: z.uuid(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  cancelledAt: isoDateTime.nullable(),
  state: promotionState,
  daysLeft: z.number().int(),
});
export type PilotPromotion = z.infer<typeof pilotPromotionSchema>;

/** What the business portal shows: the promotion, if any, and the rate that follows it. */
export const businessPromotionSchema = z.object({
  promotion: pilotPromotionSchema.nullable(),
  /** The platform default commission for each mode after the promotion, in basis points. */
  standardBps: z.object({
    shop: z.number().int().nullable(),
    services: z.number().int().nullable(),
  }),
});
export type BusinessPromotion = z.infer<typeof businessPromotionSchema>;

export const adminPilotPromotionSchema = pilotPromotionSchema.extend({
  business: z.object({
    id: z.uuid(),
    name: localizedTextSchema,
    emirate: emirateCodeSchema.nullable(),
    modes: z.array(z.enum(['shop', 'services'])),
  }),
  founderApproval: z.string(),
  createdBy: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** Sales captured while the promotion applied. */
  sales: z.object({
    count: z.number().int(),
    grossFils: z.number().int(),
    commissionBaseFils: z.number().int(),
  }),
});
export type AdminPilotPromotion = z.infer<typeof adminPilotPromotionSchema>;

export const pilotDashboardSchema = z.object({
  emirate: emirateCodeSchema,
  durationDays: z.number().int(),
  targets: z.object({ shop: z.number().int(), services: z.number().int() }),
  /** Businesses with a promotion that is scheduled or active, by mode. */
  enrolled: z.object({ shop: z.number().int(), services: z.number().int() }),
  /** The pilot is never started by the system; this states that it needs the founder. */
  launch: z.literal('founder_approval_required'),
  promotions: z.array(adminPilotPromotionSchema),
  checkedAt: isoDateTime,
});
export type PilotDashboard = z.infer<typeof pilotDashboardSchema>;

export const createPilotPromotionRequestSchema = z.strictObject({
  businessId: z.uuid(),
  /** Defaults to now. Never in the past: earlier sales keep their rate. */
  startsAt: isoDateTime.optional(),
  /** Where the founder approved this business, e.g. "Founder email, 2 December 2026". */
  founderApproval: z.string().trim().min(5).max(500),
});
export type CreatePilotPromotionRequest = z.infer<typeof createPilotPromotionRequestSchema>;

export const cancelPilotPromotionRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
