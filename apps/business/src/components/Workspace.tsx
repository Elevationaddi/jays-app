import { ApiClientError } from '@jays/api-client';
import type { BusinessView } from '@jays/contracts';
import { fils, formatAed } from '@jays/domain';
import type { Locale } from '@jays/i18n';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { serverApi } from '../lib/api';
import { BusinessNav, type Tab } from './BusinessNav';
import { ErrorAlert } from './ErrorAlert';
import { TopBar } from './TopBar';

/** Loads the business the member is working in, or 404s (also for businesses they are not in). */
export async function loadBusiness(businessId: string): Promise<BusinessView> {
  try {
    return await (await serverApi()).business(businessId);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
}

/** The shared workspace frame: top bar, business name, tabs, title and flash messages. */
export function Workspace({
  locale,
  business,
  tab,
  path,
  title,
  intro,
  error,
  notice,
  children,
}: {
  locale: Locale;
  business: BusinessView;
  tab: Tab;
  path: string;
  title: string;
  intro?: string | undefined;
  error?: string | undefined;
  notice?: string | undefined;
  children: ReactNode;
}) {
  return (
    <>
      <TopBar locale={locale} returnTo={path} signedIn />
      <main className="page">
        <p className="muted" style={{ marginBottom: 4 }}>
          {business.displayName[locale]}
        </p>
        <BusinessNav locale={locale} business={business} current={tab} />
        <h1>{title}</h1>
        {intro ? <p className="muted">{intro}</p> : null}
        <ErrorAlert locale={locale} code={error} />
        {notice ? (
          <div className="alert info" role="status">
            {notice}
          </div>
        ) : null}
        {children}
      </main>
    </>
  );
}

/** AED amount from integer fils for a form field (no grouping, two decimals). */
export const aedInput = (fils: number) => (fils / 100).toFixed(2);

/** Formats integer fils as AED for display in the locale. */
export const money = (amount: number, locale: Locale) => formatAed(fils(amount), locale);
