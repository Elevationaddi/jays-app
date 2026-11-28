import type { AdminView } from '@jays/contracts';
import { t, type Locale, type MessageKey } from '@jays/i18n';
import Link from 'next/link';

export type Search = Promise<Record<string, string | undefined>>;

export const FINANCE_TABS = [
  'overview',
  'payments',
  'refunds',
  'payouts',
  'earnings',
  'disputes',
  'reconciliation',
  'tax',
] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];

const hrefOf = (tab: FinanceTab) =>
  tab === 'overview' ? '/admin/finance' : `/admin/finance/${tab}`;

/** Second-level navigation inside the finance module. */
export function FinanceTabs({ locale, current }: { locale: Locale; current: FinanceTab }) {
  return (
    <nav className="tabs filters" aria-label={t(locale, 'admin.nav.finance')}>
      {FINANCE_TABS.map((tab) => (
        <Link key={tab} href={hrefOf(tab)} aria-current={current === tab ? 'page' : undefined}>
          {t(locale, `admin.finance.tab.${tab}` as MessageKey)}
        </Link>
      ))}
    </nav>
  );
}

/** AED from signed fils: balances can go negative after a chargeback. */
export function money(amountFils: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountFils / 100);
}

export function dateTime(locale: Locale) {
  const f = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  return (iso: string | null | undefined) => (iso ? f.format(new Date(iso)) : '—');
}

export function can(admin: AdminView, capability: string) {
  return admin.capabilities.includes(capability as AdminView['capabilities'][number]);
}

/** A short id for display; the full id is in the title for copying. */
export function ShortId({ id }: { id: string | null }) {
  if (!id) return <>—</>;
  return (
    <code className="ltr-inline" title={id}>
      {id.slice(0, 8)}
    </code>
  );
}

export function Notice({
  locale,
  params,
}: {
  locale: Locale;
  params: Record<string, string | undefined>;
}) {
  if (!params['done']) return null;
  return (
    <div className="alert info" role="status">
      {t(locale, 'common.saved')}
    </div>
  );
}

export function Pager({
  href,
  cursor,
  locale,
}: {
  href: string;
  cursor: string | null;
  locale: Locale;
}) {
  if (!cursor) return null;
  const sep = href.includes('?') ? '&' : '?';
  return (
    <p>
      <Link href={`${href}${sep}cursor=${encodeURIComponent(cursor)}`}>
        {t(locale, 'common.next')} →
      </Link>
    </p>
  );
}

export function Forbidden({ locale }: { locale: Locale }) {
  return <div className="alert error">{t(locale, 'admin.forbidden')}</div>;
}
