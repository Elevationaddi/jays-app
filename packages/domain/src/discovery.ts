/**
 * Product discovery (phase 8.6, ADR-0023): sorting, sale prices, wishlists and back-in-stock
 * alerts. Ratings and sales counts are always computed from real reviews and paid orders.
 */

export const PRODUCT_SORTS = [
  'newest',
  'price_asc',
  'price_desc',
  'rating',
  'popular',
  'discount',
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** "Popular" counts units in orders paid within this many days. */
export const POPULAR_WINDOW_DAYS = 90;
export const WISHLIST_MAX = 200;
export const STOCK_ALERTS_MAX = 50;
export const RELATED_PRODUCTS_LIMIT = 8;
export const FACET_BRANDS_LIMIT = 30;

/**
 * Whole percent saved against the compare-at (was) price, rounded down so a badge never
 * overstates the saving. Null when there is no genuine earlier price above the current one.
 */
export function discountPercent(priceFils: number, compareAtFils: number | null): number | null {
  if (compareAtFils === null || compareAtFils <= priceFils || priceFils < 0) return null;
  const pct = Math.floor(((compareAtFils - priceFils) * 100) / compareAtFils);
  return pct >= 1 ? pct : null;
}

/** A compare-at price is accepted only above the price it is shown against. */
export function validCompareAt(priceFils: number, compareAtFils: number | null | undefined) {
  return compareAtFils === null || compareAtFils === undefined || compareAtFils > priceFils;
}

/** Average rating rounded to one decimal, or null without reviews. */
export function ratingSummary(
  sum: number,
  count: number,
): { average: number; count: number } | null {
  if (count <= 0) return null;
  return { average: Math.round((sum / count) * 10) / 10, count };
}
