import { isLocale, negotiateLocale, type Locale } from '@jays/i18n';

export const LOCALE_COOKIE = 'lang';

/** An explicit cookie choice wins; otherwise the browser's Accept-Language decides. */
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  return isLocale(cookieValue) ? cookieValue : negotiateLocale(acceptLanguage);
}
