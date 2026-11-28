import {
  BLOCK_KINDS,
  BOOKING_LOCATIONS,
  BOOKING_STATUSES,
  BUSINESS_BOOKING_TRANSITIONS,
  SERVICE_LOCATION_MODES,
  TAX_CLASSES,
} from '@jays/domain';
import { z } from 'zod';
import { emirateCodeSchema, isoDateTime, phoneSchema } from './identity.js';
import { localizedInputSchema } from './onboarding.js';

/**
 * Branches, services, staff, schedules, availability and bookings (phase 4, docs/07-api.md,
 * ADR-0014). Weekly hours and shifts are local wall-clock times ("HH:MM") in the branch's
 * timezone; every other time is an ISO instant. Money is integer fils.
 */

const localized = z.object({ en: z.string(), ar: z.string() });
const cursorQuery = {
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
const ref = z.object({ id: z.uuid(), name: localized });

export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM')
  .refine((t) => Number(t.slice(3)) % 5 === 0, 'on a 5-minute boundary');
export const localDateSchema = z.iso.date();
export const bookingStatusSchema = z.enum(BOOKING_STATUSES);

const weeklyIntervalShape = {
  weekday: z.number().int().min(0).max(6),
  start: localTimeSchema,
  end: localTimeSchema,
};
const ordered = (v: { start: string; end: string }) => v.end > v.start;
export const weeklyIntervalSchema = z
  .strictObject(weeklyIntervalShape)
  .refine(ordered, { message: 'end must be after start', path: ['end'] });
export type WeeklyIntervalInput = z.infer<typeof weeklyIntervalSchema>;

function noOverlaps<T extends { weekday: number; start: string; end: string }>(
  list: T[],
  key: (v: T) => string = (v) => String(v.weekday),
) {
  const sorted = [...list].sort((a, b) =>
    key(a) === key(b) ? (a.start < b.start ? -1 : 1) : key(a) < key(b) ? -1 : 1,
  );
  return sorted.every((v, i) => {
    const prev = sorted[i - 1];
    return !prev || key(prev) !== key(v) || prev.end <= v.start;
  });
}

// ---------------------------------------------------------------------------------------------
// Branches

const hoursSchema = z
  .array(weeklyIntervalSchema)
  .max(21)
  .refine((h) => noOverlaps(h), 'opening hours overlap on the same day');

export const branchInputSchema = z.strictObject({
  name: localizedInputSchema(2, 80),
  emirate: emirateCodeSchema,
  area: z.string().trim().min(1).max(120),
  street: z.string().trim().min(1).max(160),
  building: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  hours: hoursSchema,
});
export type BranchInput = z.infer<typeof branchInputSchema>;

export const updateBranchRequestSchema = z
  .strictObject({
    name: localizedInputSchema(2, 80).optional(),
    emirate: emirateCodeSchema.optional(),
    area: z.string().trim().min(1).max(120).optional(),
    street: z.string().trim().min(1).max(160).optional(),
    building: z.string().trim().min(1).max(120).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    hours: hoursSchema.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateBranchRequest = z.infer<typeof updateBranchRequestSchema>;

export const weeklyIntervalViewSchema = z.object(weeklyIntervalShape);

export const branchSchema = z.object({
  id: z.uuid(),
  name: localized,
  emirate: emirateCodeSchema,
  area: z.string(),
  street: z.string(),
  building: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  status: z.enum(['active', 'archived']),
  hours: z.array(weeklyIntervalViewSchema),
});
export type Branch = z.infer<typeof branchSchema>;

export const closureInputSchema = z
  .strictObject({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    reason: z.string().trim().max(200).nullable().optional(),
  })
  .refine((c) => Date.parse(c.endsAt) > Date.parse(c.startsAt), {
    message: 'must be after startsAt',
    path: ['endsAt'],
  });
export type ClosureInput = z.infer<typeof closureInputSchema>;

export const closureSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  reason: z.string().nullable(),
});

// ---------------------------------------------------------------------------------------------
// Services

const minutes5 = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .refine((m) => m % 5 === 0, 'a multiple of 5 minutes');

const serviceFields = {
  categoryId: z.uuid(),
  title: localizedInputSchema(2, 120),
  description: localizedInputSchema(10, 2000),
  priceFils: z.number().int().min(1).max(100_000_000),
  taxClass: z.enum(TAX_CLASSES),
  durationMin: minutes5(5, 480),
  bufferBeforeMin: minutes5(0, 120),
  bufferAfterMin: minutes5(0, 120),
  /** Free cancellation until this many hours before the start (D7: the merchant's choice). */
  cancelCutoffHours: z.number().int().min(0).max(168),
  /** Share refunded for a customer cancellation after the cutoff, in basis points. */
  lateCancelRefundBps: z.number().int().min(0).max(10_000),
  /** Share refunded when the customer does not come, in basis points (D7, phase 8.8). */
  noShowRefundBps: z.number().int().min(0).max(10_000),
  branchIds: z.array(z.uuid()).max(50),
  /** At the venue, at the customer's address, or both (D9). Home needs approved home services. */
  locationMode: z.enum(SERVICE_LOCATION_MODES),
};

export const serviceInputSchema = z.strictObject({
  ...serviceFields,
  taxClass: serviceFields.taxClass.default('standard'),
  bufferBeforeMin: serviceFields.bufferBeforeMin.default(0),
  bufferAfterMin: serviceFields.bufferAfterMin.default(0),
  cancelCutoffHours: serviceFields.cancelCutoffHours.default(24),
  lateCancelRefundBps: serviceFields.lateCancelRefundBps.default(0),
  noShowRefundBps: serviceFields.noShowRefundBps.default(0),
  locationMode: serviceFields.locationMode.default('in_venue'),
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;

export const updateServiceRequestSchema = z
  .strictObject({
    categoryId: serviceFields.categoryId.optional(),
    title: serviceFields.title.optional(),
    description: serviceFields.description.optional(),
    priceFils: serviceFields.priceFils.optional(),
    taxClass: serviceFields.taxClass.optional(),
    durationMin: serviceFields.durationMin.optional(),
    bufferBeforeMin: serviceFields.bufferBeforeMin.optional(),
    bufferAfterMin: serviceFields.bufferAfterMin.optional(),
    cancelCutoffHours: serviceFields.cancelCutoffHours.optional(),
    lateCancelRefundBps: serviceFields.lateCancelRefundBps.optional(),
    noShowRefundBps: serviceFields.noShowRefundBps.optional(),
    branchIds: serviceFields.branchIds.optional(),
    locationMode: serviceFields.locationMode.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

export const serviceStatusSchema = z.enum(['active', 'suspended', 'archived']);

export const serviceSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  title: localized,
  description: localized,
  priceFils: z.number().int(),
  taxClass: z.enum(TAX_CLASSES),
  durationMin: z.number().int(),
  bufferBeforeMin: z.number().int(),
  bufferAfterMin: z.number().int(),
  cancelCutoffHours: z.number().int(),
  lateCancelRefundBps: z.number().int(),
  noShowRefundBps: z.number().int(),
  locationMode: z.enum(SERVICE_LOCATION_MODES),
  status: serviceStatusSchema,
  suspensionReason: z.string().nullable(),
  version: z.number().int(),
  branchIds: z.array(z.uuid()),
  staffIds: z.array(z.uuid()),
});
export type Service = z.infer<typeof serviceSchema>;

// ---------------------------------------------------------------------------------------------
// Staff, shifts and blocks

const bioSchema = localizedInputSchema(10, 600);

export const staffInputSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  /** A short bilingual introduction shown to customers (phase 8.7). */
  bio: bioSchema.nullable().optional(),
  /** Link to a member account so the professional can sign in and see their own appointments. */
  membershipId: z.uuid().nullable().optional(),
  branchIds: z.array(z.uuid()).min(1).max(50),
  serviceIds: z.array(z.uuid()).max(200),
});
export type StaffInput = z.infer<typeof staffInputSchema>;

export const updateStaffRequestSchema = z
  .strictObject({
    displayName: staffInputSchema.shape.displayName.optional(),
    bio: bioSchema.nullable().optional(),
    membershipId: z.uuid().nullable().optional(),
    branchIds: staffInputSchema.shape.branchIds.optional(),
    serviceIds: staffInputSchema.shape.serviceIds.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateStaffRequest = z.infer<typeof updateStaffRequestSchema>;

export const shiftInputSchema = z
  .strictObject({ branchId: z.uuid(), ...weeklyIntervalShape })
  .refine(ordered, { message: 'end must be after start', path: ['end'] });

export const putShiftsRequestSchema = z.strictObject({
  shifts: z
    .array(shiftInputSchema)
    .max(50)
    // One person cannot work two overlapping shifts, whatever the branch.
    .refine((s) => noOverlaps(s), 'shifts overlap on the same day'),
});
export type PutShiftsRequest = z.infer<typeof putShiftsRequestSchema>;

export const shiftSchema = z.object({ id: z.uuid(), branchId: z.uuid(), ...weeklyIntervalShape });

export const staffSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  bio: localized.nullable(),
  membershipId: z.uuid().nullable(),
  status: z.enum(['active', 'archived']),
  branchIds: z.array(z.uuid()),
  serviceIds: z.array(z.uuid()),
  shifts: z.array(shiftSchema),
});
export type Staff = z.infer<typeof staffSchema>;

export const blockKindSchema = z.enum(BLOCK_KINDS);
export const blockInputSchema = z
  .strictObject({
    staffId: z.uuid(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    kind: blockKindSchema,
    reason: z.string().trim().max(200).nullable().optional(),
  })
  .refine((b) => Date.parse(b.endsAt) > Date.parse(b.startsAt), {
    message: 'must be after startsAt',
    path: ['endsAt'],
  })
  .refine((b) => Date.parse(b.endsAt) - Date.parse(b.startsAt) <= 31 * 86_400_000, {
    message: 'at most 31 days',
    path: ['endsAt'],
  });
export type BlockInput = z.infer<typeof blockInputSchema>;

export const blockSchema = z.object({
  id: z.uuid(),
  staffId: z.uuid(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  kind: blockKindSchema,
  reason: z.string().nullable(),
});

export const blockListQuerySchema = z.strictObject({
  staffId: z.uuid().optional(),
  from: isoDateTime.optional(),
  ...cursorQuery,
});
export type BlockListQuery = z.infer<typeof blockListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Public venue and availability

const venueRating = z.object({ average: z.number().min(1).max(5), count: z.number().int().min(1) });

export const publicAddonSchema = z.object({
  id: z.uuid(),
  title: localized,
  /** Added to the service price; VAT-inclusive like it. */
  priceFils: z.number().int(),
  /** Added to the appointment's length. */
  durationMin: z.number().int(),
});
export type PublicAddon = z.infer<typeof publicAddonSchema>;

export const publicPortfolioItemSchema = z.object({
  id: z.uuid(),
  imageUrl: z.string(),
  caption: localized.nullable(),
  serviceId: z.uuid().nullable(),
  staffId: z.uuid().nullable(),
});
export type PublicPortfolioItem = z.infer<typeof publicPortfolioItemSchema>;

export const publicVenueSchema = z.object({
  id: z.uuid(),
  name: localized,
  description: localized.nullable(),
  logoUrl: z.string().nullable(),
  branches: z.array(
    z.object({
      id: z.uuid(),
      name: localized,
      emirate: emirateCodeSchema,
      area: z.string(),
      street: z.string(),
      building: z.string(),
      timezone: z.string(),
      hours: z.array(weeklyIntervalViewSchema),
    }),
  ),
  services: z.array(
    z.object({
      id: z.uuid(),
      title: localized,
      description: localized,
      priceFils: z.number().int(),
      durationMin: z.number().int(),
      cancelCutoffHours: z.number().int(),
      lateCancelRefundBps: z.number().int(),
      noShowRefundBps: z.number().int(),
      locationMode: z.enum(SERVICE_LOCATION_MODES),
      branchIds: z.array(z.uuid()),
      addons: z.array(publicAddonSchema),
      /** From published reviews of completed appointments; null without any. */
      rating: venueRating.nullable(),
    }),
  ),
  /** Home visits, when the business is approved for them; null otherwise. */
  homeServices: z
    .object({
      minOrderFils: z.number().int(),
      areas: z.array(
        z.object({
          emirate: emirateCodeSchema,
          area: z.string().nullable(),
          travelFeeFils: z.number().int(),
        }),
      ),
    })
    .nullable(),
  staff: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string(),
      bio: localized.nullable(),
      branchIds: z.array(z.uuid()),
      serviceIds: z.array(z.uuid()),
      rating: venueRating.nullable(),
    }),
  ),
  /** Photos of past work, newest arrangement first; filter by serviceId or staffId. */
  portfolio: z.array(publicPortfolioItemSchema),
  rating: venueRating.nullable(),
});
export type PublicVenue = z.infer<typeof publicVenueSchema>;

const addonIdsQuery = z
  .string()
  .max(400)
  .optional()
  .transform((v) => (v ? v.split(',').filter(Boolean) : []))
  .pipe(z.array(z.uuid()).max(10));

export const availabilityQuerySchema = z.strictObject({
  branchId: z.uuid(),
  serviceId: z.uuid(),
  date: localDateSchema,
  staffId: z.uuid().optional(),
  /** Home visits keep the travel buffer free around each appointment. */
  location: z.enum(BOOKING_LOCATIONS).default('venue'),
  /** Comma-separated add-on ids; their minutes lengthen the appointment. */
  addonIds: addonIdsQuery,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const availabilitySchema = z.object({
  date: localDateSchema,
  timeZone: z.string(),
  slots: z.array(
    z.object({ startAt: isoDateTime, endAt: isoDateTime, staffIds: z.array(z.uuid()) }),
  ),
});
export type Availability = z.infer<typeof availabilitySchema>;

// ---------------------------------------------------------------------------------------------
// Customer bookings

export const holdRequestSchema = z
  .strictObject({
    branchId: z.uuid(),
    serviceId: z.uuid(),
    startAt: isoDateTime,
    /** Omit or null for "any professional". */
    staffId: z.uuid().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    location: z.enum(BOOKING_LOCATIONS).default('venue'),
    /** One of the customer's saved addresses; required for a home visit. */
    addressId: z.uuid().nullable().optional(),
    /** Add-ons of this service, each at most once (phase 8.7). */
    addonIds: z.array(z.uuid()).max(10).default([]),
  })
  .refine((b) => b.location !== 'home' || !!b.addressId, {
    message: 'required for a home visit',
    path: ['addressId'],
  })
  .refine((b) => b.location === 'home' || !b.addressId, {
    message: 'only for a home visit',
    path: ['addressId'],
  });
export type HoldRequest = z.infer<typeof holdRequestSchema>;

export const rescheduleRequestSchema = z.strictObject({
  startAt: isoDateTime,
  staffId: z.uuid().nullable().optional(),
});
export type RescheduleRequest = z.infer<typeof rescheduleRequestSchema>;

export const cancelBookingRequestSchema = z.strictObject({
  reason: z.string().trim().max(500).nullable().optional(),
});
export type CancelBookingRequest = z.infer<typeof cancelBookingRequestSchema>;

const policySchema = z.object({
  cutoffHours: z.number().int(),
  lateRefundBps: z.number().int(),
  noShowRefundBps: z.number().int(),
});

export const TRAVEL_STATUS_VALUES = ['not_started', 'on_the_way', 'arrived'] as const;
export const travelStatusSchema = z.enum(TRAVEL_STATUS_VALUES);

export const travelUpdateRequestSchema = z.strictObject({
  status: z.enum(['on_the_way', 'arrived']),
  expectedVersion: z.number().int().min(1),
});
export type TravelUpdateRequest = z.infer<typeof travelUpdateRequestSchema>;

export const homeAddressSchema = z.object({
  addressId: z.uuid(),
  label: z.string().nullable(),
  emirate: emirateCodeSchema,
  area: z.string(),
  street: z.string(),
  building: z.string(),
  unit: z.string().nullable(),
  directions: z.string().nullable(),
});
export type HomeAddressView = z.infer<typeof homeAddressSchema>;

const bookingCore = {
  id: z.uuid(),
  status: bookingStatusSchema,
  startAt: isoDateTime,
  endAt: isoDateTime,
  timeZone: z.string(),
  holdExpiresAt: isoDateTime.nullable(),
  business: ref,
  branch: z.object({
    id: z.uuid(),
    name: localized,
    emirate: emirateCodeSchema,
    area: z.string(),
    street: z.string(),
    building: z.string(),
  }),
  service: z.object({ id: z.uuid(), title: localized, durationMin: z.number().int() }),
  staff: z.object({ id: z.uuid(), displayName: z.string() }),
  location: z.enum(BOOKING_LOCATIONS),
  /** The address as booked, for a home visit. */
  homeAddress: homeAddressSchema.nullable(),
  /** Included in priceFils. */
  travelFeeFils: z.number().int(),
  /** A home visit's travel status (ADR-0025); null for venue bookings. */
  travelStatus: travelStatusSchema.nullable(),
  /** Add-ons as booked; their total is addonsFils, included in priceFils. */
  addons: z.array(publicAddonSchema),
  addonsFils: z.number().int(),
  priceFils: z.number().int(),
  taxFils: z.number().int(),
  currency: z.literal('AED'),
  policy: policySchema,
  refundFils: z.number().int().nullable(),
  canceledBy: z.enum(['customer', 'business', 'system']).nullable(),
  rescheduledCount: z.number().int(),
  version: z.number().int(),
  createdAt: isoDateTime,
};

export const bookingSchema = z.object({
  ...bookingCore,
  /** What a customer cancellation would refund right now; null when it cannot be canceled. */
  cancelRefundFils: z.number().int().nullable(),
  canReschedule: z.boolean(),
  payment: z
    .object({
      status: z.string(),
      paymentIntentId: z.string().nullable(),
      paymentClientSecret: z.string().nullable(),
    })
    .nullable(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingListQuerySchema = z.strictObject({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  ...cursorQuery,
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

export const payBookingResponseSchema = z.object({
  bookingId: z.uuid(),
  status: bookingStatusSchema,
  amountFils: z.number().int(),
  currency: z.literal('AED'),
  holdExpiresAt: isoDateTime.nullable(),
  paymentIntentId: z.string().nullable(),
  paymentClientSecret: z.string().nullable(),
});
export type PayBookingResponse = z.infer<typeof payBookingResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Business calendar

export const merchantBookingSchema = z.object({
  ...bookingCore,
  source: z.enum(['customer', 'manual']),
  paymentMode: z.enum(['prepaid', 'pay_at_venue']),
  paymentStatus: z.string().nullable(),
  customer: z.object({ name: z.string().nullable(), phone: z.string().nullable() }),
  note: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /**
   * Each part of the price (ADR-0025, ADR-0027). Shown on a single appointment; null in lists.
   * Commission fields are null until the payment is captured (and stay null when paid at the
   * venue). The provider's processing fee is not known until phase 9.
   */
  amounts: z
    .object({
      serviceFils: z.number().int(),
      addonsFils: z.number().int(),
      travelFeeFils: z.number().int(),
      vatFils: z.number().int(),
      discountFils: z.number().int(),
      commissionFils: z.number().int().nullable(),
      commissionVatFils: z.number().int().nullable(),
      processingFeeFils: z.number().int().nullable(),
      refundedFils: z.number().int(),
      merchantNetFils: z.number().int().nullable(),
    })
    .nullable(),
  /** Travel steps recorded for a home visit, oldest first. Empty in lists. */
  travelEvents: z.array(z.object({ status: z.enum(['on_the_way', 'arrived']), at: isoDateTime })),
});
export type MerchantBooking = z.infer<typeof merchantBookingSchema>;

export const merchantBookingListQuerySchema = z
  .strictObject({
    from: localDateSchema,
    to: localDateSchema,
    branchId: z.uuid().optional(),
    staffId: z.uuid().optional(),
    status: bookingStatusSchema.optional(),
    ...cursorQuery,
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((q) => q.to >= q.from, { message: 'must not be before from', path: ['to'] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 31 * 86_400_000, {
    message: 'at most 31 days',
    path: ['to'],
  });
export type MerchantBookingListQuery = z.infer<typeof merchantBookingListQuerySchema>;

export const bookingActionRequestSchema = z.strictObject({
  action: z.enum(BUSINESS_BOOKING_TRANSITIONS),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(500).nullable().optional(),
});
export type BookingActionRequest = z.infer<typeof bookingActionRequestSchema>;

export const manualBookingRequestSchema = z.strictObject({
  branchId: z.uuid(),
  serviceId: z.uuid(),
  staffId: z.uuid(),
  startAt: isoDateTime,
  customerName: z.string().trim().min(1).max(120),
  customerPhone: phoneSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type ManualBookingRequest = z.infer<typeof manualBookingRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Admin

export const adminBookingListQuerySchema = z.strictObject({
  status: bookingStatusSchema.optional(),
  businessId: z.uuid().optional(),
  ...cursorQuery,
});
export type AdminBookingListQuery = z.infer<typeof adminBookingListQuerySchema>;

export const adminBookingSchema = merchantBookingSchema.extend({
  paymentNeedsAttention: z.boolean(),
});
export type AdminBooking = z.infer<typeof adminBookingSchema>;

export const adminServiceListQuerySchema = z.strictObject({
  status: z.enum(['active', 'suspended', 'archived', 'all']).default('active'),
  ...cursorQuery,
});
export type AdminServiceListQuery = z.infer<typeof adminServiceListQuerySchema>;

export const adminServiceSchema = serviceSchema.extend({ business: ref });
export type AdminService = z.infer<typeof adminServiceSchema>;

export const adminServiceActionRequestSchema = z.strictObject({
  action: z.enum(['suspend', 'reinstate']),
  reason: z.string().trim().min(3).max(1000),
  expectedVersion: z.number().int().min(1),
});
export type AdminServiceActionRequest = z.infer<typeof adminServiceActionRequestSchema>;
