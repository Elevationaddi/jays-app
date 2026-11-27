import { type Locale, type MessageKey, t } from '@jays/i18n';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale } from './locale';

export async function currentLocale(): Promise<Locale> {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value, list.get('accept-language'));
}

/** A translator bound to the request's locale. */
export async function translator() {
  const locale = await currentLocale();
  return {
    locale,
    tr: (key: MessageKey, params?: Record<string, string | number>) => t(locale, key, params),
  };
}
