import { BOOKING_LOCATIONS, SERVICE_LOCATION_MODES, SERVICE_SORTS } from '@jays/domain';
import { z } from 'zod';
import { emirateCodeSchema, isoDateTime } from './identity.js';
import { localizedInputSchema } from './onboarding.js';

/**
 * Service discovery (phase 8.7, ADR-0026): search, add-ons, portfolios, "next available",
 * waitlists and rebooking. Times in waitlists are the branch's local wall-clock ("HH:MM").
 */

const localized = z.object({ en: z.string(), ar: z.string() });
const fils = z.number().int();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const rating = z.object({ average: z.number().min(1).max(5), count: z.number().int().min(1) });

// ---------------------------------------------------------------------------------------------
// Add-ons (business)

const addonFields = {
  title: localizedInputSchema(2, 80),
  /** VAT-inclusive, added to the service price. 0 for a free extra. */
  priceFils: z.number().int().min(0).max(10_000_000),
  /** Extra minutes, on the 5-minute grid. */
  durationMin: z
    .number()
    .int()
    .min(0)
    .max(240)
    .refine((m) => m % 5 === 0, 'must be a multiple of 5'),
  sortOrder: z.number().int().min(0).max(99),
};

export const addonInputSchema = z.strictObject({
  ...addonFields,
  sortOrder: addonFields.sortOrder.default(0),
});
export type AddonInput = z.infer<typeof addonInputSchema>;

export const updateAddonRequestSchema = z
  .strictObject({
    title: addonFields.title.optional(),
    priceFils: addonFields.priceFils.optional(),
    durationMin: addonFields.durationMin.optional(),
    sortOrder: addonFields.sortOrder.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateAddonRequest = z.infer<typeof updateAddonRequestSchema>;

export const addonSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  title: localized,
  priceFils: fils,
  durationMin: z.number().int(),
  sortOrder: z.number().int(),
  status: z.enum(['active', 'archived']),
});
export type Addon = z.infer<typeof addonSchema>;

export const addonListSchema = z.object({ items: z.array(addonSchema) });

// ---------------------------------------------------------------------------------------------
// Portfolio (business)

export const createPortfolioItemRequestSchema = z.strictObject({
  /** A ready image uploaded with purpose portfolio_image. */
  mediaId: z.uuid(),
  serviceId: z.uuid().nullable().optional(),
  staffId: z.uuid().nullable().optional(),
  caption: localizedInputSchema(2, 200).nullable().optional(),
  sortOrder: z.number().int().min(0).max(99).default(0),
});
export type CreatePortfolioItemRequest = z.infer<typeof createPortfolioItemRequestSchema>;

export const portfolioItemSchema = z.object({
  id: z.uuid(),
  mediaId: z.uuid(),
  imageUrl: z.string(),
  caption: localized.nullable(),
  serviceId: z.uuid().nullable(),
  staffId: z.uuid().nullable(),
  sortOrder: z.number().int(),
  createdAt: isoDateTime,
});
export type PortfolioItem = z.infer<typeof portfolioItemSchema>;

export const portfolioListSchema = z.object({ items: z.array(portfolioItemSchema) });

export const portfolioImageUploadRequestSchema = z.strictObject({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
});

// ---------------------------------------------------------------------------------------------
// Service search (public)

export const serviceSortSchema = z.enum(SERVICE_SORTS);
export type ServiceSort = z.infer<typeof serviceSortSchema>;

export const serviceListQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.uuid().optional(),
  /** Offered at a branch in this emirate, or as a home visit covering it. */
  emirate: emirateCodeSchema.optional(),
  /** venue: has a branch to visit; home: comes to the customer. */
  location: z.enum(BOOKING_LOCATIONS).optional(),
  minPriceFils: z.coerce.number().int().min(0).optional(),
  maxPriceFils: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  sort: serviceSortSchema.default('relevance'),
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ServiceListQuery = z.infer<typeof serviceListQuerySchema>;

export const publicServiceListItemSchema = z.object({
  id: z.uuid(),
  title: localized,
  categoryId: z.uuid(),
  priceFils: fils,
  durationMin: z.number().int(),
  /** Where it can be booked now (home only when the business's home services are active). */
  locationMode: z.enum(SERVICE_LOCATION_MODES),
  venue: z.object({ id: z.uuid(), name: localized, logoUrl: z.string().nullable() }),
  /** Emirates of the branches that offer it. */
  emirates: z.array(emirateCodeSchema),
  imageUrl: z.string().nullable(),
  rating: rating.nullable(),
  addonCount: z.number().int(),
  currency: z.literal('AED'),
});
export type PublicServiceListItem = z.infer<typeof publicServiceListItemSchema>;

export const nextAvailableQuerySchema = z.strictObject({
  branchId: z.uuid().optional(),
  staffId: z.uuid().optional(),
  location: z.enum(BOOKING_LOCATIONS).default('venue'),
});
export type NextAvailableQuery = z.infer<typeof nextAvailableQuerySchema>;

export const nextAvailableSchema = z.object({
  /** The earliest free start in the next 14 days, or null when nothing is free. */
  startAt: isoDateTime.nullable(),
  branchId: z.uuid().nullable(),
  timeZone: z.string().nullable(),
  staffIds: z.array(z.uuid()),
});
export type NextAvailable = z.infer<typeof nextAvailableSchema>;

// ---------------------------------------------------------------------------------------------
// Waitlist (customer)

export const joinWaitlistRequestSchema = z
  .strictObject({
    branchId: z.uuid(),
    serviceId: z.uuid(),
    staffId: z.uuid().nullable().optional(),
    date: z.iso.date(),
    windowStart: hhmm.default('00:00'),
    windowEnd: hhmm.default('23:59'),
  })
  .refine((b) => b.windowEnd > b.windowStart, {
    message: 'end must be after start',
    path: ['windowEnd'],
  });
export type JoinWaitlistRequest = z.infer<typeof joinWaitlistRequestSchema>;

export const waitlistEntrySchema = z.object({
  id: z.uuid(),
  status: z.enum(['active', 'notified', 'canceled', 'expired']),
  date: z.iso.date(),
  windowStart: z.string(),
  windowEnd: z.string(),
  timeZone: z.string(),
  venue: z.object({ id: z.uuid(), name: localized }),
  branch: z.object({ id: z.uuid(), name: localized }),
  service: z.object({ id: z.uuid(), title: localized }),
  staff: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  notifiedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

export const waitlistListSchema = z.object({ items: z.array(waitlistEntrySchema) });

// ---------------------------------------------------------------------------------------------
// Rebooking (customer)

export const rebookSchema = z.object({
  venueId: z.uuid(),
  branchId: z.uuid(),
  serviceId: z.uuid(),
  /** The same professional, when they still offer the service there; otherwise null (anyone). */
  staffId: z.uuid().nullable(),
  /** The add-ons booked last time that are still offered. */
  addonIds: z.array(z.uuid()),
  location: z.enum(BOOKING_LOCATIONS),
  addressId: z.uuid().nullable(),
  /** False when the service, branch or business is no longer bookable. */
  available: z.boolean(),
  /** What changed since last time, for the customer to see. */
  changes: z.array(z.enum(['staff_unavailable', 'addon_unavailable', 'price_changed'])),
  priceFils: fils.nullable(),
});
export type Rebook = z.infer<typeof rebookSchema>;
