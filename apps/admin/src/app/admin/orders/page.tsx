import { fils, formatAed } from '@jays/domain';
import Link from 'next/link';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;
const STATUSES = ['paid', 'processing', 'shipped', 'delivered', 'canceled'] as const;

/** Fulfillment monitoring across merchants (docs/04-admin.md, /admin/orders). Read-only. */
export default async function OrdersPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/orders');
  if (!admin.capabilities.includes('orders.view')) {
    return (
      <Shell locale={locale} admin={admin} current="orders">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const status = (STATUSES as readonly string[]).includes(params['status'] ?? '')
    ? params['status']
    : undefined;
  const stuck = params['stuck'] === 'true';
  const page = await api.adminOrders({
    limit: 50,
    ...(status ? { status } : {}),
    ...(stuck ? { stuck: true } : {}),
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const at = (iso: string | null) => (iso ? when.format(new Date(iso)) : '—');
  return (
    <Shell locale={locale} admin={admin} current="orders">
      <h1>{tr('admin.orders.title')}</h1>
      <p className="muted">{tr('admin.orders.intro')}</p>
      <nav className="tabs filters" aria-label={tr('admin.orders.status')}>
        <Link href="/admin/orders" aria-current={!status && !stuck ? 'page' : undefined}>
          {tr('admin.bookings.all')}
        </Link>
        <Link href="/admin/orders?stuck=true" aria-current={stuck ? 'page' : undefined}>
          {tr('admin.orders.stuck')}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/orders?status=${s}`}
            aria-current={status === s ? 'page' : undefined}
          >
            {tr(`merchantOrderStatus.${s}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.orders.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.orders.order')}</th>
                <th>{tr('admin.orders.business')}</th>
                <th>{tr('admin.orders.status')}</th>
                <th>{tr('money.total')}</th>
                <th>{tr('admin.orders.paid')}</th>
                <th>{tr('admin.orders.tracking')}</th>
                <th>{tr('admin.orders.delivered')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((o) => (
                <tr key={o.id}>
                  <td className="ltr">#{o.orderId.slice(0, 8).toUpperCase()}</td>
                  <td>
                    <Link href={`/admin/businesses/${o.business.id}`}>
                      {o.business.name[locale]}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge ${o.status}`}>
                      {tr(`merchantOrderStatus.${o.status as 'paid'}`)}
                    </span>
                    {o.openReturn ? (
                      <span className="badge requested">{tr('admin.orders.return')}</span>
                    ) : null}
                  </td>
                  <td>{formatAed(fils(o.totalFils), locale)}</td>
                  <td>{at(o.paidAt)}</td>
                  <td>
                    {o.carrier ? (
                      <>
                        {o.carrier} <span className="ltr">{o.trackingNumber}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{at(o.deliveredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p>
          <Link
            href={`/admin/orders?${new URLSearchParams({
              ...(status ? { status } : {}),
              ...(stuck ? { stuck: 'true' } : {}),
              cursor: page.nextCursor,
            })}`}
          >
            {tr('common.more')}
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
