import type { BusinessView } from '@jays/contracts';
import { t, type Locale } from '@jays/i18n';
import Link from 'next/link';

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
  | 'team';

/** Workspace tabs, shown only for what the member's capabilities allow. */
export function BusinessNav({
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
    <nav
      className="tabs"
      aria-label={t(locale, 'business.gateway.switch')}
      style={{ margin: '16px 0 24px' }}
    >
      {tabs
        .filter((tab) => tab.show)
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
  );
}
