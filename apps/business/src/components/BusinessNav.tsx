import type { BusinessView } from '@jays/contracts';
import { t, type Locale } from '@jays/i18n';
import Link from 'next/link';

type Tab = 'gateway' | 'verification' | 'storefront' | 'team';

/** Workspace tabs, shown only for what the member's capabilities allow. */
export function BusinessNav({
  locale,
  business,
  current,
}: {
  locale: Locale;
  business: Pick<BusinessView, 'id' | 'myCapabilities'>;
  current: Tab;
}) {
  const can = (c: BusinessView['myCapabilities'][number]) => business.myCapabilities.includes(c);
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
