import type { AdminView } from '@jays/contracts';
import { t, type Locale } from '@jays/i18n';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { TopBar } from './TopBar';

/** Desktop admin layout: sidebar navigation and content. Only implemented modules are links. */
export function Shell({
  locale,
  admin,
  current,
  children,
}: {
  locale: Locale;
  admin: AdminView;
  current: 'dashboard' | 'businesses' | 'products' | 'content' | 'security';
  children: ReactNode;
}) {
  const items = [
    {
      key: 'dashboard',
      href: '/admin/dashboard',
      label: t(locale, 'admin.nav.dashboard'),
      show: true,
    },
    {
      key: 'businesses',
      href: '/admin/businesses',
      label: t(locale, 'admin.nav.businesses'),
      show: admin.capabilities.includes('businesses.view'),
    },
    {
      key: 'products',
      href: '/admin/products',
      label: t(locale, 'admin.nav.products'),
      show: admin.capabilities.includes('products.view'),
    },
    {
      key: 'content',
      href: '/admin/content',
      label: t(locale, 'admin.nav.content'),
      show: admin.capabilities.includes('taxonomy.manage'),
    },
    {
      key: 'security',
      href: '/admin/security',
      label: t(locale, 'admin.nav.security'),
      show:
        admin.capabilities.includes('admins.manage') || admin.capabilities.includes('audit.view'),
    },
  ] as const;
  return (
    <>
      <TopBar locale={locale} returnTo={`/admin/${current}`} signedIn name={admin.displayName} />
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 70px)', flexWrap: 'wrap' }}>
        <nav
          aria-label="Admin"
          style={{
            width: 220,
            padding: 16,
            borderInlineEnd: '1px solid var(--border)',
            background: 'var(--surface-raised)',
          }}
        >
          <ul className="list" style={{ gap: 4 }}>
            {items
              .filter((i) => i.show)
              .map((i) => (
                <li key={i.key}>
                  <Link
                    className="btn ghost block"
                    style={{ justifyContent: 'flex-start' }}
                    href={i.href}
                    aria-current={current === i.key ? 'page' : undefined}
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
          </ul>
        </nav>
        <main className="page" style={{ flex: 1, margin: 0, maxWidth: 1100 }}>
          {children}
        </main>
      </div>
    </>
  );
}
