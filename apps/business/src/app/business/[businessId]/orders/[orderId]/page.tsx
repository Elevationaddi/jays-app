import { ApiClientError } from '@jays/api-client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Workspace, loadBusiness, money } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';

export default async function MerchantOrderPage({
  params,
}: {
  params: Promise<{ businessId: string; orderId: string }>;
}) {
  const { businessId, orderId } = await params;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  let order;
  try {
    order = await (await serverApi()).merchantOrder(businessId, orderId);
  } catch (error) {
    if (error instanceof ApiClientError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }
  const a = order.address;
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="orders"
      path={`/business/${businessId}/orders/${orderId}`}
      title={`#${order.orderId.slice(0, 8).toUpperCase()}`}
    >
      <p className="meta">
        <Link href={`/business/${businessId}/orders`}>{tr('orders.back')}</Link>
        <span className={`badge ${order.status}`}>{tr(`merchantOrderStatus.${order.status}`)}</span>
      </p>
      <div className="split">
        <section className="card">
          <h2>{tr('orders.title')}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.title[locale]}</strong>
                      <div className="muted">
                        {i.variantName[locale]} · <span className="ltr">{i.sku}</span>
                      </div>
                    </td>
                    <td>× {i.qty}</td>
                    <td>{money(i.lineTotalFils, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="totals">
            <dt>{tr('money.subtotal')}</dt>
            <dd>{money(order.subtotalFils, locale)}</dd>
            <dt>{tr('money.delivery')}</dt>
            <dd>{order.deliveryFils ? money(order.deliveryFils, locale) : tr('money.free')}</dd>
            <dt>{tr('money.vat')}</dt>
            <dd>{money(order.taxFils, locale)}</dd>
            <dt>
              <strong>{tr('money.total')}</strong>
            </dt>
            <dd>
              <strong>{money(order.totalFils, locale)}</strong>
            </dd>
          </dl>
        </section>
        <aside className="card">
          <h2>{tr('orders.address')}</h2>
          <p style={{ margin: 0 }}>
            <strong>{order.customerName ?? tr('orders.customer')}</strong>
          </p>
          <p style={{ margin: 0 }}>
            {[a.unit, a.building, a.street, a.area].filter(Boolean).join(', ')}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {a.emirate} ·{' '}
            {tr('orders.deliveryWindow', {
              min: order.delivery.minDays,
              max: order.delivery.maxDays,
            })}
          </p>
        </aside>
      </div>
    </Workspace>
  );
}
