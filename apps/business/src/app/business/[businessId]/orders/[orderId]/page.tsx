import { ApiClientError } from '@jays/api-client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Workspace, loadBusiness, money } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { fulfil } from '../../aftercare-actions';

export default async function MerchantOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; orderId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { businessId, orderId } = await params;
  const query = await searchParams;
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
  const f = order.fulfillment;
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  const hidden = (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="merchantOrderId" value={order.id} />
      <input type="hidden" name="expectedStatus" value={order.status} />
    </>
  );
  const canStart = order.status === 'paid';
  const canShip = order.status === 'paid' || order.status === 'processing';
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="orders"
      path={`/business/${businessId}/orders/${orderId}`}
      title={`#${order.orderId.slice(0, 8).toUpperCase()}`}
      error={query['error']}
      notice={query['saved'] ? tr('fulfil.saved') : undefined}
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
            {a.emirate} · {tr(`delivery.method.${order.delivery.method}`)} ·{' '}
            {tr('orders.deliveryWindow', {
              min: order.delivery.minDays,
              max: order.delivery.maxDays,
            })}
          </p>
        </aside>
      </div>
      <div className="split" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>{tr('fulfil.title')}</h2>
          {f.carrier ? (
            <p>
              {f.partner ? <span className="badge">{tr('fulfil.partnerBadge')}</span> : null}{' '}
              {tr('fulfil.shippedWith', { carrier: f.carrier })}{' '}
              <span className="ltr">{f.trackingNumber}</span>
              {f.trackingUrl ? (
                <>
                  {' · '}
                  <a href={f.trackingUrl} rel="noreferrer noopener" target="_blank">
                    {tr('fulfil.track')}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {canStart ? (
            <form action={fulfil} className="inline-form">
              {hidden}
              <input type="hidden" name="action" value="process" />
              <button className="btn secondary">{tr('fulfil.process')}</button>
            </form>
          ) : null}
          {canShip && order.partnerAvailable ? (
            <form action={fulfil} className="stack">
              {hidden}
              <input type="hidden" name="action" value="ship" />
              <input type="hidden" name="usePartner" value="1" />
              <h3>{tr('fulfil.partnerTitle')}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {tr('fulfil.partnerHint')}
              </p>
              <button className="btn secondary">{tr('fulfil.partnerShip')}</button>
            </form>
          ) : null}
          {canShip ? (
            <form action={fulfil} className="stack">
              {hidden}
              <input type="hidden" name="action" value="ship" />
              <h3>{tr('fulfil.ship')}</h3>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="carrier">{tr('fulfil.carrier')}</label>
                  <input id="carrier" name="carrier" required maxLength={80} />
                </div>
                <div className="field">
                  <label htmlFor="trackingNumber">{tr('fulfil.trackingNumber')}</label>
                  <input
                    id="trackingNumber"
                    name="trackingNumber"
                    required
                    maxLength={100}
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="trackingUrl">{tr('fulfil.trackingUrl')}</label>
                <input
                  id="trackingUrl"
                  name="trackingUrl"
                  type="url"
                  pattern="https://.*"
                  dir="ltr"
                />
              </div>
              <button className="btn">{tr('fulfil.markShipped')}</button>
            </form>
          ) : null}
          {order.status === 'shipped' ? (
            <form action={fulfil} className="inline-form">
              {hidden}
              <input type="hidden" name="action" value="deliver" />
              <button className="btn">{tr('fulfil.markDelivered')}</button>
            </form>
          ) : null}
          {canShip ? (
            <form action={fulfil} className="stack" style={{ marginTop: 16 }}>
              {hidden}
              <input type="hidden" name="action" value="cancel" />
              <h3>{tr('fulfil.cancel')}</h3>
              <p className="muted">{tr('fulfil.cancelHint')}</p>
              <div className="field">
                <label htmlFor="reason">{tr('fulfil.reason')}</label>
                <input id="reason" name="reason" required minLength={3} maxLength={1000} />
              </div>
              <button className="btn danger">{tr('fulfil.cancelConfirm')}</button>
            </form>
          ) : null}
          {order.status === 'delivered' || order.status === 'canceled' ? (
            <p className="muted">{tr('fulfil.final')}</p>
          ) : null}
        </section>
        <aside className="card">
          <h2>{tr('fulfil.timeline')}</h2>
          <ol className="timeline">
            {f.timeline.map((e, i) => (
              <li key={i}>
                <strong>{tr(`merchantOrderStatus.${e.status as 'paid'}`)}</strong>
                <span className="muted"> · {when.format(new Date(e.at))}</span>
                {e.note ? <div className="muted">{e.note}</div> : null}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </Workspace>
  );
}
