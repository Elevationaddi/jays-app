import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;
const FILTERS = ['pending', 'approved', 'rejected', 'suspended'] as const;

/** Home-service applications (D9): licence review before a business may visit customers. */
export default async function HomeServicesPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/home-services');
  if (!admin.capabilities.includes('businesses.view')) {
    return (
      <Shell locale={locale} admin={admin} current="homeServices">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const status = (FILTERS as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as (typeof FILTERS)[number])
    : 'pending';
  const page = await api.adminHomeServices({
    status,
    limit: 50,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Shell locale={locale} admin={admin} current="homeServices">
      <h1>{tr('admin.home.title')}</h1>
      <p className="muted">{tr('admin.home.intro')}</p>
      <ErrorAlert locale={locale} code={params['error']} />
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/home-services?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {tr(`home.status.${f}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.home.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('admin.product.store')}</th>
                <th scope="col">{tr('home.licenseNumber')}</th>
                <th scope="col">{tr('home.licenseExpiry')}</th>
                <th scope="col">{tr('home.areasTitle')}</th>
                <th scope="col">{tr('admin.home.submitted')}</th>
                <th scope="col">{tr('admin.bookings.status')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((p) => (
                <tr key={p.businessId}>
                  <td>
                    <Link href={`/admin/home-services/${p.businessId}`}>
                      <strong>{p.business.name[locale]}</strong>
                    </Link>
                  </td>
                  <td>
                    <span className="ltr-inline">{p.licenseNumber ?? '—'}</span>
                  </td>
                  <td>
                    <span className="ltr-inline">{p.licenseExpiry ?? '—'}</span>
                  </td>
                  <td>{p.areas.length}</td>
                  <td>{p.submittedAt ? date.format(new Date(p.submittedAt)) : '—'}</td>
                  <td>
                    <span className={`badge ${p.status}`}>{tr(`home.status.${p.status}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p>
          <Link
            href={`/admin/home-services?status=${status}&cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            {tr('common.next')} →
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
