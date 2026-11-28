import type { MessageKey } from '@jays/i18n';
import Link from 'next/link';
import { Workspace, loadBusiness, money } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A row of daily bars; the figures are also in a table for screen readers. */
function Daily({
  points,
  label,
  format,
}: {
  points: { date: string; value: number }[];
  label: string;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <figure className="chart">
      <figcaption>{label}</figcaption>
      <div className="bars" aria-hidden="true">
        {points.map((p) => (
          <span
            key={p.date}
            title={`${p.date}: ${format(p.value)}`}
            style={{ height: `${(p.value / max) * 100}%` }}
          />
        ))}
      </div>
      <table className="sr-only">
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * Business dashboard (docs/03-business.md; metric definitions in ADR-0016): sales, refunds,
 * suborder statuses, open returns and low stock for a shop; bookings, revenue and occupancy for
 * services. Owners, managers and finance members (`dashboard.view`).
 */
export default async function DashboardPage({
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
  const path = `/business/${businessId}/dashboard`;
  const frame = { locale, business, tab: 'dashboard' as const, path, title: tr('dashboard.title') };
  if (!business.myCapabilities.includes('dashboard.view')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const range = {
    ...(DATE.test(query['from'] ?? '') ? { from: query['from'] } : {}),
    ...(DATE.test(query['to'] ?? '') ? { to: query['to'] } : {}),
  };
  const d = await (await serverApi()).businessDashboard(businessId, range);
  const m = (n: number) => money(n, locale);
  const canStatement = business.myCapabilities.includes('finance.view');
  return (
    <Workspace {...frame} intro={tr('dashboard.intro')} error={query['error']}>
      <form className="inline-form" method="get">
        <label htmlFor="from">{tr('dashboard.from')}</label>
        <input id="from" name="from" type="date" defaultValue={d.from} />
        <label htmlFor="to">{tr('dashboard.to')}</label>
        <input id="to" name="to" type="date" defaultValue={d.to} />
        <button className="btn secondary">{tr('dashboard.apply')}</button>
        {canStatement ? (
          <a
            className="btn secondary"
            href={`/business/${businessId}/finance/statement?from=${d.from}&to=${d.to}`}
          >
            {tr('dashboard.statement')}
          </a>
        ) : null}
      </form>
      {d.shop ? (
        <section style={{ marginTop: 24 }}>
          <h2>{tr('dashboard.shop')}</h2>
          <div className="stats">
            {(
              [
                ['dashboard.gross', m(d.shop.grossSalesFils)],
                ['dashboard.refunds', m(d.shop.refundsFils)],
                ['dashboard.net', m(d.shop.netSalesFils)],
                ['dashboard.openReturns', String(d.shop.openReturns)],
              ] as [MessageKey, string][]
            ).map(([k, v]) => (
              <div key={k} className="card stat">
                <span className="muted">{tr(k)}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <p className="meta">
            {(['paid', 'processing', 'shipped', 'delivered', 'canceled'] as const).map((s) => (
              <span key={s} className={`badge ${s}`}>
                {tr(`merchantOrderStatus.${s}`)}: {d.shop?.orders[s]}
              </span>
            ))}
          </p>
          <Daily points={d.shop.daily} label={tr('dashboard.dailySales')} format={m} />
          <h3>{tr('dashboard.lowStock')}</h3>
          {d.shop.lowStock.length === 0 ? (
            <p className="muted">{tr('dashboard.noLowStock')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {d.shop.lowStock.map((v) => (
                    <tr key={v.variantId}>
                      <td>{v.title[locale]}</td>
                      <td className="ltr">{v.sku}</td>
                      <td>{tr('dashboard.available', { n: v.available })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                <Link href={`/business/${businessId}/inventory`}>
                  {tr('business.nav.inventory')}
                </Link>
              </p>
            </div>
          )}
        </section>
      ) : null}
      {d.services ? (
        <section style={{ marginTop: 24 }}>
          <h2>{tr('dashboard.services')}</h2>
          <div className="stats">
            {(
              [
                ['dashboard.bookings', String(d.services.bookings)],
                ['dashboard.completed', String(d.services.completed)],
                ['dashboard.canceled', String(d.services.canceled)],
                ['dashboard.noShows', String(d.services.noShows)],
                ['dashboard.revenue', m(d.services.revenueFils)],
                [
                  'dashboard.occupancy',
                  d.services.occupancy === null
                    ? '—'
                    : `${Math.round(d.services.occupancy * 100)}%`,
                ],
              ] as [MessageKey, string][]
            ).map(([k, v]) => (
              <div key={k} className="card stat">
                <span className="muted">{tr(k)}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <Daily points={d.services.daily} label={tr('dashboard.dailyRevenue')} format={m} />
        </section>
      ) : null}
      {!d.shop && !d.services ? <p className="muted">{tr('dashboard.noModes')}</p> : null}
      <p className="muted" style={{ marginTop: 24 }}>
        {tr('dashboard.definitions')}
      </p>
    </Workspace>
  );
}
