import { z } from 'zod';
import { emirateCodeSchema, isoDateTime, localizedTextSchema } from './identity.js';

/** Operations controls (ADR-0018 D11, D12; ADR-0020). */

export const adminEmirateSchema = z.object({
  code: emirateCodeSchema,
  name: localizedTextSchema,
  enabled: z.boolean(),
  /** Active branches there (bookings stop while the emirate is off). */
  branches: z.number().int(),
  /** Customers who chose it as their emirate. */
  customers: z.number().int(),
});
export type AdminEmirate = z.infer<typeof adminEmirateSchema>;
export const adminEmirateListSchema = z.object({ items: z.array(adminEmirateSchema) });
export const updateEmirateRequestSchema = z.strictObject({ enabled: z.boolean() });

export const supportInfoSchema = z.object({
  /** Proposed hours (D12), in the UAE time zone. */
  hours: z.object({ opens: z.string(), closes: z.string(), timeZone: z.literal('Asia/Dubai') }),
  openNow: z.boolean(),
  /** Target for the first reply, in hours. */
  firstResponseHours: z.number().int(),
  checkedAt: isoDateTime,
});
export type SupportInfo = z.infer<typeof supportInfoSchema>;
