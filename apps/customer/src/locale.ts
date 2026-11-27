import { isLocale, type Locale, textDirection } from '@jays/i18n';

/**
 * Picks the app locale from the device's preferred language tags.
 * Phase 1 adds the explicit in-app language choice on /welcome, which will take precedence.
 */
export function deviceLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export function isRtl(locale: Locale): boolean {
  return textDirection(locale) === 'rtl';
}
