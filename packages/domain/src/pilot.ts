/**
 * The Abu Dhabi pilot (founder decisions 28 November 2026; ADR-0025, ADR-0034). These are the
 * approved targets. The pilot itself starts only with the founder's explicit approval.
 */
export const PILOT = {
  emirate: 'AUH',
  durationDays: 30,
  targets: { shop: 30, services: 20 },
} as const;

/** Each approved pilot merchant pays 0% platform commission for this many days. */
export const PILOT_PROMOTION_DAYS = 30;

/** Days before the end of a promotion when the merchant is told the commission will change. */
export const PILOT_NOTICE_DAYS = [7, 1] as const;

const DAY_MS = 86_400_000;

export interface PromotionWindow {
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
}

/** When the promotion actually stops: its end, or its cancellation if that came first. */
export function promotionStopsAt(p: PromotionWindow): Date {
  return p.cancelledAt && p.cancelledAt < p.endsAt ? p.cancelledAt : p.endsAt;
}

/** Whether a sale captured at `at` gets 0% commission. Start inclusive, stop exclusive. */
export function promotionApplies(p: PromotionWindow, at: Date): boolean {
  return p.startsAt <= at && at < promotionStopsAt(p);
}

export function promotionEndsAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() + PILOT_PROMOTION_DAYS * DAY_MS);
}

/** Whole days left (rounded up), or 0 once it has stopped. */
export function promotionDaysLeft(p: PromotionWindow, now: Date): number {
  const left = promotionStopsAt(p).getTime() - Math.max(now.getTime(), p.startsAt.getTime());
  return left > 0 ? Math.ceil(left / DAY_MS) : 0;
}

export type PromotionState = 'scheduled' | 'active' | 'ended' | 'cancelled';

export function promotionState(p: PromotionWindow, now: Date): PromotionState {
  if (p.cancelledAt && p.cancelledAt <= now && p.cancelledAt < p.endsAt) return 'cancelled';
  if (now < p.startsAt) return 'scheduled';
  return now < p.endsAt ? 'active' : 'ended';
}
