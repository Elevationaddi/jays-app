import { fils, formatAed } from '@jays/domain';
import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';
import { actOnService } from './actions';

type Search = Promise<Record<string, string | undefined>>;
const FILTERS = ['active', 'suspended', 'archived', 'all'] as const;

export default async function ServicesPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/services');
  if (!admin.capabilities.includes('services.takedown')) {
    return (
      <Shell locale={locale} admin={admin} current="services">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const status = (FILTERS as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as (typeof FILTERS)[number])
    : 'active';
  const page = await api.adminServices({
    status,
    limit: 50,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const label = (f: (typeof FILTERS)[number]) =>
    f === 'all' ? tr('admin.bookings.all') : tr(`service.status.${f}`);
  return (
    <Shell locale={locale} admin={admin} current="services">
      <h1>{tr('admin.services.title')}</h1>
      <p className="muted">{tr('admin.services.intro')}</p>
      <ErrorAlert locale={locale} code={params['error']} />
      {params['done'] ? (
        <div className="alert info" role="status">
          {tr('common.saved')}
        </div>
      ) : null}
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/services?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {label(f)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.services.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('services.list')}</th>
                <th>{tr('admin.product.store')}</th>
                <th>{tr('admin.bookings.status')}</th>
                <th>
                  <span className="sr-only">{tr('admin.services.suspend')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.title[locale]}</strong>
                    <div className="muted">
                      {tr('service.summary', {
                        duration: s.durationMin,
                        price: formatAed(fils(s.priceFils), locale),
                      })}
                    </div>
                  </td>
                  <td>{s.business.name[locale]}</td>
                  <td>
                    <span className={`badge ${s.status}`}>{tr(`service.status.${s.status}`)}</span>
                    {s.suspensionReason ? <div className="muted">{s.suspensionReason}</div> : null}
                  </td>
                  <td>
                    {s.status === 'active' || s.status === 'suspended' ? (
                      <form action={actOnService} className="inline-form">
                        <input type="hidden" name="serviceId" value={s.id} />
                        <input type="hidden" name="expectedVersion" value={s.version} />
                        <input type="hidden" name="status" value={status} />
                        <input
                          type="hidden"
                          name="action"
                          value={s.status === 'active' ? 'suspend' : 'reinstate'}
                        />
                        <label className="sr-only" htmlFor={`reason-${s.id}`}>
                          {tr('admin.services.reason')}
                        </label>
                        <input
                          id={`reason-${s.id}`}
                          name="reason"
                          type="text"
                          required
                          minLength={3}
                          maxLength={1000}
                          placeholder={tr('admin.services.reason')}
                        />
                        <button
                          className={s.status === 'active' ? 'btn danger' : 'btn secondary'}
                          type="submit"
                        >
                          {tr(
                            s.status === 'active'
                              ? 'admin.services.suspend'
                              : 'admin.services.reinstate',
                          )}
                        </button>
                      </form>
                    ) : null}
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
            href={`/admin/services?status=${status}&cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            {tr('common.next')} →
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
