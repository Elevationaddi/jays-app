import type { BusinessView } from '@jays/contracts';
import { t, type Locale } from '@jays/i18n';
import { cookies } from 'next/headers';
import Link from 'next/link';
import {
  MODE_TABS,
  WORKSPACE_MODE_COOKIE,
  resolveMode,
  type WorkspaceMode,
} from '../lib/workspace';

export type Tab =
  | 'gateway'
  | 'verification'
  | 'storefront'
  | 'products'
  | 'inventory'
  | 'delivery'
  | 'orders'
  | 'services'
  | 'staff'
  | 'calendar'
  | 'finance'
  | 'returns'
  | 'reviews'
  | 'dashboard'
  | 'team';

/**
 * Workspace navigation. A business that runs both products and services gets a clear
 * "Manage Products | Manage Services" switch; the tab row then shows the shared tabs plus only
 * the tabs of the current mode. Tabs are shown only for what the member's capabilities allow.
 */
export async function BusinessNav({
  locale,
  business,
  current,
}: {
  locale: Locale;
  business: Pick<BusinessView, 'id' | 'myCapabilities' | 'modes'>;
  current: Tab;
}) {
  const can = (c: BusinessView['myCapabilities'][number]) => business.myCapabilities.includes(c);
  const services = business.modes.services !== 'not_activated';
  const activated = (['shop', 'services'] as const).filter(
    (m) => business.modes[m] !== 'not_activated',
  );
  const preferred = (await cookies()).get(WORKSPACE_MODE_COOKIE)?.value;
  const mode: WorkspaceMode = resolveMode(current, business.modes, preferred);
  const other: WorkspaceMode = mode === 'shop' ? 'services' : 'shop';
  const hiddenTabs = activated.length === 2 || activated[0] === mode ? MODE_TABS[other] : [];
  const tabs: { key: Tab; href: string; label: string; show: boolean }[] = [
    {
      key: 'gateway',
      href: '/business/gateway',
      label: t(locale, 'business.nav.gateway'),
      show: true,
    },
    {
      key: 'verification',
      href: `/business/${business.id}/onboarding`,
      label: t(locale, 'business.nav.verification'),
      show: can('onboarding.manage'),
    },
    {
      key: 'dashboard',
      href: `/business/${business.id}/dashboard`,
      label: t(locale, 'business.nav.dashboard'),
      show: can('dashboard.view'),
    },
    {
      key: 'storefront',
      href: `/business/${business.id}/storefront`,
      label: t(locale, 'business.nav.storefront'),
      show: can('storefront.manage'),
    },
    {
      key: 'products',
      href: `/business/${business.id}/products`,
      label: t(locale, 'business.nav.products'),
      show: can('catalog.manage'),
    },
    {
      key: 'inventory',
      href: `/business/${business.id}/inventory`,
      label: t(locale, 'business.nav.inventory'),
      show: can('inventory.adjust'),
    },
    {
      key: 'delivery',
      href: `/business/${business.id}/delivery`,
      label: t(locale, 'business.nav.delivery'),
      show: can('storefront.manage'),
    },
    {
      key: 'orders',
      href: `/business/${business.id}/orders`,
      label: t(locale, 'business.nav.orders'),
      show: can('orders.fulfill'),
    },
    {
      key: 'returns',
      href: `/business/${business.id}/returns`,
      label: t(locale, 'business.nav.returns'),
      show: can('returns.manage'),
    },
    {
      key: 'reviews',
      href: `/business/${business.id}/reviews`,
      label: t(locale, 'business.nav.reviews'),
      show: can('reviews.respond'),
    },
    {
      key: 'calendar',
      href: `/business/${business.id}/calendar`,
      label: t(locale, 'business.nav.calendar'),
      show: services && (can('appointments.view_all') || can('appointments.view_own')),
    },
    {
      key: 'services',
      href: `/business/${business.id}/services`,
      label: t(locale, 'business.nav.services'),
      show: services && can('services.manage'),
    },
    {
      key: 'staff',
      href: `/business/${business.id}/staff`,
      label: t(locale, 'business.nav.staff'),
      show: services && (can('services.manage') || can('bookings.schedule')),
    },
    {
      key: 'finance',
      href: `/business/${business.id}/finance`,
      label: t(locale, 'business.nav.finance'),
      show: can('finance.view'),
    },
    {
      key: 'team',
      href: `/business/${business.id}/team`,
      label: t(locale, 'business.nav.team'),
      show: can('members.view'),
    },
  ];
  return (
    <div style={{ margin: '16px 0 24px' }}>
      {activated.length === 2 ? (
        <nav className="switcher mode-switch" aria-label={t(locale, 'business.mode.switch')}>
          {activated.map((m) => (
            <Link
              key={m}
              href={`/business/${business.id}/mode/${m}`}
              className={m === mode ? 'btn' : 'btn secondary'}
              aria-current={m === mode ? 'true' : undefined}
              prefetch={false}
            >
              {t(locale, `business.mode.${m}`)}
            </Link>
          ))}
        </nav>
      ) : null}
      <nav className="tabs" aria-label={t(locale, 'business.nav.label')}>
        {tabs
          .filter((tab) => tab.show && !hiddenTabs.includes(tab.key))
          .map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={current === tab.key ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}
