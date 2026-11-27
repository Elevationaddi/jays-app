import { fils, formatAed } from '@jays/domain';
import type { Locale } from '@jays/i18n';

/** Formats integer fils as AED in the locale. */
export const money = (amount: number, locale: Locale) => formatAed(fils(amount), locale);

/** A time of day in the UAE, for payment and price-hold deadlines. */
export const timeOfDay = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));

/** A random idempotency key (Idempotency-Key header format: 16 to 100 safe characters). */
export function newIdempotencyKey(prefix: string): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A date in the UAE, e.g. "Mon, 7 Dec". */
export const shortDate = (iso: string, locale: Locale, timeZone = 'Asia/Dubai') =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(iso));

/** A time of day in a branch's timezone. */
export const timeIn = (iso: string, locale: Locale, timeZone: string) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
