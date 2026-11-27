/**
 * Timestamps are stored in UTC. UAE venues display in Asia/Dubai (UTC+4, no daylight saving),
 * but branch timezone is stored per branch so this is a default, not an assumption baked into
 * calculations. See docs/adr/0005.
 */
export const DEFAULT_TIMEZONE = 'Asia/Dubai';

/** Default booking start grid in minutes (docs/05-workflows.md: 15, configurable). */
export const DEFAULT_SLOT_GRID_MINUTES = 15;

/** Default booking hold duration in minutes (docs/05-workflows.md). */
export const DEFAULT_HOLD_MINUTES = 10;

/** Formats a UTC instant as local wall-clock time in a given IANA timezone. */
export function formatInTimezone(
  instant: Date,
  timeZone: string,
  locale: 'en' | 'ar',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const tag = locale === 'ar' ? 'ar-AE' : 'en-AE';
  return new Intl.DateTimeFormat(tag, { ...options, timeZone }).format(instant);
}
