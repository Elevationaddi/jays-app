import type { MessageKey } from '@jays/i18n';
import { fils, formatAed } from '@jays/domain';
import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['payments', 'refunds', 'payouts', 'orders', 'bookings'] as const;

/**
 * Platform dashboard (docs/04-admin.md; metric definitions in ADR-0016). Figures need
 * `orders.view`; exports need `exports.run`. Everyone sees their own account card.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/dashboard');
  const can = (c: (typeof admin.capabilities)[number]) => admin.capabilities.includes(c);
  const range = {
    ...(DATE.test(params['from'] ?? '') ? { from: params['from'] } : {}),
    ...(DATE.test(params['to'] ?? '') ? { to: params['to'] } : {}),
  };
  const d = can('orders.view') ? await api.adminDashboard(range) : null;
  const usage = can('operations.manage') ? await api.adminUsage() : null;
  const mb = (n: number) =>
    new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', { maximumFractionDigits: 1 }).format(
      n / (1024 * 1024),
    );
  const num = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-AE').format(n);
  const m = (n: number) => formatAed(fils(n), locale);
  const max = d ? Math.max(1, ...d.daily.map((x) => x.shop + x.services)) : 1;
  return (
    <Shell locale={locale} admin={admin} current="dashboard">
      <h1>{tr('admin.dashboard.title')}</h1>
      <ErrorAlert locale={locale} code={params['error']} />
      {d ? (
        <>
          <form className="inline-form" method="get">
            <label htmlFor="from">{tr('dashboard.from')}</label>
            <input id="from" name="from" type="date" defaultValue={d.from} />
            <label htmlFor="to">{tr('dashboard.to')}</label>
            <input id="to" name="to" type="date" defaultValue={d.to} />
            <button className="btn secondary">{tr('dashboard.apply')}</button>
          </form>
          <div className="stats">
            {(
              [
                ['admin.dash.gmvShop', m(d.gmvFils.shop)],
                ['admin.dash.gmvServices', m(d.gmvFils.services)],
                ['dashboard.refunds', m(d.refundsFils)],
                ['admin.dash.commission', m(d.commissionFils)],
                ['admin.dash.orders', String(d.orders)],
                ['dashboard.bookings', String(d.bookings)],
                ['admin.dash.activeMerchants', String(d.activeMerchants)],
                ['admin.dash.newAccounts', String(d.newCustomers)],
              ] as [MessageKey, string][]
            ).map(([k, v]) => (
              <div key={k} className="card stat">
                <span className="muted">{tr(k)}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <figure className="chart">
            <figcaption>{tr('admin.dash.daily')}</figcaption>
            <div className="bars" aria-hidden="true">
              {d.daily.map((x) => (
                <span
                  key={x.date}
                  title={`${x.date}: ${m(x.shop)} + ${m(x.services)}`}
                  style={{ height: `${((x.shop + x.services) / max) * 100}%` }}
                />
              ))}
            </div>
            <table className="sr-only">
              <tbody>
                {d.daily.map((x) => (
                  <tr key={x.date}>
                    <th scope="row">{x.date}</th>
                    <td>{m(x.shop)}</td>
                    <td>{m(x.services)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
          <h2>{tr('admin.dash.openWork')}</h2>
          <div className="stats">
            {(
              [
                ['admin.dash.pendingVerification', d.pendingVerification, '/admin/businesses'],
                ['admin.dash.openDisputes', d.openDisputes, '/admin/finance/disputes'],
                ['admin.dash.payoutExceptions', d.payoutExceptions, '/admin/finance/payouts'],
                ['admin.dash.openTickets', d.openTickets, '/admin/support'],
                ['admin.dash.overdueTickets', d.overdueTickets, '/admin/support'],
                ['admin.dash.reportedReviews', d.reportedReviews, '/admin/reviews'],
                ['admin.dash.failedNotifications', d.failedNotifications, '/admin/notifications'],
              ] as [MessageKey, number, string][]
            ).map(([k, v, href]) => (
              <Link key={k} href={href} className={`card stat${v > 0 ? ' attention' : ''}`}>
                <span className="muted">{tr(k)}</span>
                <strong>{v}</strong>
              </Link>
            ))}
          </div>
          <p className="muted">{tr('dashboard.definitions')}</p>
        </>
      ) : (
        <div className="alert info">{tr('admin.dashboard.note')}</div>
      )}
      {usage ? (
        <section className="card" style={{ marginTop: 24 }} aria-labelledby="usage-title">
          <h2 id="usage-title">{tr('admin.usage.title')}</h2>
          <p className="muted">{tr('admin.usage.intro')}</p>
          <div className="stats">
            {(
              [
                ['admin.usage.database', usage.databaseBytes, mb, 'admin.usage.mb'],
                ['admin.usage.storage', usage.storageBytes, mb, 'admin.usage.mb'],
                ['admin.usage.emailsToday', usage.emailsToday, num, null],
                ['admin.usage.emailsMonth', usage.emailsThisMonth, num, null],
              ] as [
                MessageKey,
                { used: number; limit: number },
                (n: number) => string,
                MessageKey | null,
              ][]
            ).map(([k, meter, fmt, unit]) => {
              const share = meter.limit > 0 ? meter.used / meter.limit : 0;
              return (
                <div key={k} className={`card stat${share >= usage.warnAt ? ' attention' : ''}`}>
                  <span className="muted">{tr(k)}</span>
                  <strong>
                    {fmt(meter.used)} / {fmt(meter.limit)}
                    {unit ? ` ${tr(unit)}` : ''}
                  </strong>
                  <meter min={0} max={1} high={usage.warnAt} value={Math.min(1, share)} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      {can('exports.run') ? (
        <section className="card" style={{ marginTop: 24 }}>
          <h2>{tr('admin.exports.title')}</h2>
          <p className="muted">{tr('admin.exports.intro')}</p>
          <p className="meta">
            {KINDS.map((k) => (
              <a
                key={k}
                className="btn secondary"
                href={`/admin/exports/${k}?from=${d?.from ?? params['from'] ?? ''}&to=${d?.to ?? params['to'] ?? ''}`}
              >
                {tr(`admin.exports.${k}`)}
              </a>
            ))}
          </p>
        </section>
      ) : null}
      <section className="card" style={{ maxWidth: 520, marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>{admin.displayName}</h2>
        <div className="muted ltr">{admin.email}</div>
        <div>
          <strong>{tr('admin.roles')}: </strong>
          {admin.roles.map((r) => tr(`role.${r}`)).join(locale === 'ar' ? '، ' : ', ')}
        </div>
      </section>
    </Shell>
  );
}
