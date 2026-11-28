/**
 * Service discovery (phase 8.7, ADR-0026): search sorts, add-ons, appointment reminders,
 * waitlists and portfolios. Ratings and popularity come only from real reviews and bookings.
 */

export const SERVICE_SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'popular'] as const;
export type ServiceSort = (typeof SERVICE_SORTS)[number];

/** "Popular" counts appointments completed or confirmed within this many days. */
export const SERVICE_POPULAR_WINDOW_DAYS = 90;

export const ADDONS_PER_SERVICE_MAX = 20;
export const ADDONS_PER_BOOKING_MAX = 10;
/** An appointment with its add-ons may last at most this long. */
export const BOOKED_DURATION_MAX_MIN = 600;

/** Reminders go out about this many hours before the start (bookings made later get none). */
export const REMINDER_LEAD_HOURS = 24;

export const WAITLIST_ACTIVE_MAX = 5;
export const PORTFOLIO_ITEMS_MAX = 60;
/** "Next available" looks this many days ahead. */
export const NEXT_AVAILABLE_SEARCH_DAYS = 14;

export interface AddonChoice {
  id: string;
  priceFils: number;
  durationMin: number;
}

export class AddonError extends Error {
  constructor(
    readonly code: 'ADDON_NOT_AVAILABLE' | 'TOO_MANY_ADDONS' | 'DURATION_TOO_LONG',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The add-ons a customer picked, checked against the service's active ones: each at most once,
 * at most ADDONS_PER_BOOKING_MAX, and the appointment no longer than BOOKED_DURATION_MAX_MIN.
 * Returns them in the service's order with the totals to add to price and duration.
 */
export function pickAddons<T extends AddonChoice>(
  available: readonly T[],
  requestedIds: readonly string[],
  serviceDurationMin: number,
): { addons: T[]; priceFils: number; durationMin: number } {
  const wanted = new Set(requestedIds);
  if (wanted.size !== requestedIds.length) {
    throw new AddonError('ADDON_NOT_AVAILABLE', 'Each add-on can be chosen once.');
  }
  if (wanted.size > ADDONS_PER_BOOKING_MAX) {
    throw new AddonError('TOO_MANY_ADDONS', `Choose at most ${ADDONS_PER_BOOKING_MAX} add-ons.`);
  }
  const addons = available.filter((a) => wanted.has(a.id));
  if (addons.length !== wanted.size) {
    throw new AddonError('ADDON_NOT_AVAILABLE', 'An add-on you chose is no longer offered.');
  }
  const priceFils = addons.reduce((sum, a) => sum + a.priceFils, 0);
  const durationMin = addons.reduce((sum, a) => sum + a.durationMin, 0);
  if (serviceDurationMin + durationMin > BOOKED_DURATION_MAX_MIN) {
    throw new AddonError(
      'DURATION_TOO_LONG',
      `An appointment can last at most ${BOOKED_DURATION_MAX_MIN / 60} hours.`,
    );
  }
  return { addons, priceFils, durationMin };
}

/**
 * The parts of a booking's VAT-inclusive price, for receipts and the ledger. The service, its
 * add-ons and the travel fee are one supply, so VAT splits in proportion to each part's share;
 * rounding lands on the service line so the parts always add up to the total.
 */
export function bookingPriceParts(input: {
  priceFils: number;
  taxFils: number;
  addonsFils: number;
  travelFeeFils: number;
}) {
  const { priceFils, taxFils, addonsFils, travelFeeFils } = input;
  const share = (part: number) => (priceFils > 0 ? Math.round((taxFils * part) / priceFils) : 0);
  const addonsVatFils = share(addonsFils);
  const travelVatFils = share(travelFeeFils);
  const serviceFils = priceFils - addonsFils - travelFeeFils;
  return {
    serviceFils,
    serviceVatFils: taxFils - addonsVatFils - travelVatFils,
    addonsFils,
    addonsVatFils,
    travelFeeFils,
    travelVatFils,
  };
}

/** Whether a local start time ("HH:MM") falls in a waitlist window [start, end). */
export function inWaitlistWindow(time: string, windowStart: string, windowEnd: string): boolean {
  const t = time.slice(0, 5);
  return t >= windowStart.slice(0, 5) && t < windowEnd.slice(0, 5);
}
