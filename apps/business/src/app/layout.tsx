import { t, textDirection } from '@jays/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { currentLocale } from '../lib/i18n';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return { title: `${t(locale, 'surface.business')} · ${t(locale, 'app.name')}` };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale} dir={textDirection(locale)}>
      <body>{children}</body>
    </html>
  );
}
