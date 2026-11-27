export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Localized content is stored as `{ en, ar }` (docs/06-architecture-data.md). */
export type Localized<T = string> = Record<Locale, T>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function textDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Picks the best supported locale from an Accept-Language style list. */
export function negotiateLocale(acceptLanguage: string | undefined | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { base: tag.toLowerCase().split('-')[0], q: q ? Number(q.split('=')[1]) : 1 };
    })
    .filter((entry) => !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);
  return (
    (ranked.find((entry) => isLocale(entry.base))?.base as Locale | undefined) ?? DEFAULT_LOCALE
  );
}
