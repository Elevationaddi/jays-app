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

const usageMeter = z.object({ used: z.number().int(), limit: z.number().int() });

/** Free-tier usage against the plan limits (ADR-0024, ADR-0033), for the admin dashboard. */
export const platformUsageSchema = z.object({
  /** PostgreSQL database size in bytes (Supabase Free: 500 MB). */
  databaseBytes: usageMeter,
  /** Accepted files in bytes, from the API's own records (Supabase Free: 1 GB). */
  storageBytes: usageMeter,
  /** Emails today (UTC) and this month (Resend Free: 100 a day, 3,000 a month). */
  emailsToday: usageMeter,
  emailsThisMonth: usageMeter,
  /** Share of a limit at which the dashboard warns. */
  warnAt: z.number(),
  checkedAt: isoDateTime,
});
export type PlatformUsage = z.infer<typeof platformUsageSchema>;
