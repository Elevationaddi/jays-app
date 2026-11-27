import type { AdminBusinessListQuery } from '@jays/contracts';
import { BUSINESS_STATUSES } from '@jays/domain';
import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;
const FILTERS = ['pending', ...BUSINESS_STATUSES, 'all'] as const;

export default async function BusinessesPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/businesses');
  if (!admin.capabilities.includes('businesses.view')) {
    return (
      <Shell locale={locale} admin={admin} current="businesses">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const status = (FILTERS as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as AdminBusinessListQuery['status'])
    : 'pending';
  const page = await api.adminBusinesses({
    status,
    limit: 50,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const label = (f: (typeof FILTERS)[number]) =>
    f === 'pending' || f === 'all'
      ? tr(`admin.businesses.filter.${f}`)
      : tr(`business.status.${f}`);

  return (
    <Shell locale={locale} admin={admin} current="businesses">
      <h1>{tr('admin.businesses.title')}</h1>
      <ErrorAlert locale={locale} code={params['error']} />
      <nav className="tabs filters" aria-label={tr('admin.businesses.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/businesses?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {label(f)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.businesses.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.businesses.name')}</th>
                <th>{tr('admin.businesses.status')}</th>
                <th>{tr('admin.businesses.modes')}</th>
                <th>{tr('admin.businesses.submitted')}</th>
                <th>
                  <span className="sr-only">{tr('admin.businesses.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.displayName[locale]}</strong>
                    {b.legalName ? <div className="muted">{b.legalName}</div> : null}
                  </td>
                  <td>
                    <span className={`badge ${b.status}`}>{tr(`business.status.${b.status}`)}</span>
                    {b.storefrontChangesPending ? (
                      <div className="muted">{tr('admin.businesses.storefrontChanges')}</div>
                    ) : null}
                  </td>
                  <td>
                    <div className="chips">
                      {(['shop', 'services'] as const)
                        .filter((m) => b.modes[m] !== 'not_activated')
                        .map((m) => (
                          <span key={m} className={`badge ${b.modes[m]}`}>
                            {tr(`business.mode.${m}`)} · {tr(`business.mode.status.${b.modes[m]}`)}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td>{b.submittedAt ? when.format(new Date(b.submittedAt)) : '—'}</td>
                  <td>
                    <Link className="btn secondary" href={`/admin/businesses/${b.id}`}>
                      {tr('admin.businesses.open')}
                    </Link>
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
            href={`/admin/businesses?status=${status}&cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            {tr('common.next')} →
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
