import { t, textDirection } from '@jays/i18n';
import { colors, typography } from '@jays/ui';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { LOCALE_COOKIE, resolveLocale } from '../lib/locale';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return { title: `${t(locale, 'surface.admin')} · ${t(locale, 'app.name')}` };
}

async function currentLocale() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get('accept-language'));
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale} dir={textDirection(locale)}>
      <body
        style={{
          margin: 0,
          background: colors.surface,
          color: colors.text,
          fontSize: typography.minBodySize,
          fontFamily: locale === 'ar' ? typography.fontFamilyArabic : typography.fontFamilyLatin,
        }}
      >
        {children}
      </body>
    </html>
  );
}
