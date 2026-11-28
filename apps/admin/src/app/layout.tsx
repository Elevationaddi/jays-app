import { t, textDirection } from '@jays/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { isStaging } from '../lib/api';
import { currentLocale } from '../lib/i18n';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return {
    robots: { index: false, follow: false },
    title: `${t(locale, 'surface.admin')} · ${t(locale, 'app.name')}`,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale} dir={textDirection(locale)}>
      <body>
        {isStaging() ? (
          <div role="note" className="staging-notice">
            {t(locale, 'staging.notice')}
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
