import Link from 'next/link';
import { Workspace, loadBusiness, money } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Search;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/orders`;
  const frame = { locale, business, tab: 'orders' as const, path, title: tr('orders.title') };
  if (!business.myCapabilities.includes('orders.fulfill')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const page = await (
    await serverApi()
  ).merchantOrders(businessId, {
    ...(query['cursor'] ? { cursor: query['cursor'] } : {}),
    limit: 50,
  });
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Workspace {...frame} intro={tr('orders.intro')} error={query['error']}>
      {page.items.length === 0 ? (
        <p className="muted">{tr('orders.empty')}</p>
      ) : (
        <ul className="list">
          {page.items.map((o) => (
            <li key={o.id} className="row">
              <div className="grow">
                <Link href={`${path}/${o.id}`}>
                  <strong className="ltr">#{o.orderId.slice(0, 8).toUpperCase()}</strong>
                </Link>
                <div className="muted" style={{ fontSize: 14 }}>
                  {tr('orders.placed', { date: date.format(new Date(o.createdAt)) })} ·{' '}
                  {o.itemCount === 1
                    ? tr('orders.items.one')
                    : tr('orders.items', { count: o.itemCount })}
                </div>
              </div>
              <strong>{money(o.totalFils, locale)}</strong>
              <span className={`badge ${o.status}`}>{tr(`merchantOrderStatus.${o.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <p>
          <Link
            className="btn secondary"
            href={`${path}?cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            {tr('common.next')}
          </Link>
        </p>
      ) : null}
    </Workspace>
  );
}
