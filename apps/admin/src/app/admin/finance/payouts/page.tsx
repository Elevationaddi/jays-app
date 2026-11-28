import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { placeHold, releaseHold, runPayouts } from '../actions';
import {
  can,
  dateTime,
  FinanceTabs,
  Forbidden,
  money,
  Notice,
  Pager,
  ShortId,
  type Search,
} from '../shared';

const FILTERS = ['all', 'pending', 'paid', 'failed'] as const;
const SKIPS = ['on_hold', 'suspended', 'pending_refund', 'below_minimum', 'nothing_owed'] as const;

export default async function PayoutsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance/payouts');
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const status = (FILTERS as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as (typeof FILTERS)[number])
    : 'all';
  const [page, holds] = await Promise.all([
    api.adminPayouts({
      limit: 50,
      ...(status !== 'all' ? { status } : {}),
      ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
    }),
    api.adminPayoutHolds(),
  ]);
  const active = holds.filter((h) => !h.releasedAt);
  const when = dateTime(locale);
  const manage = can(admin, 'finance.manage');
  const back = `/admin/finance/payouts?status=${status}`;
  const skipped = SKIPS.filter((s) => Number(params[`skip_${s}`] ?? 0) > 0);
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.finance.payouts')}</h1>
      <p className="muted">{tr('admin.finance.payoutsIntro')}</p>
      <FinanceTabs locale={locale} current="payouts" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />
      {params['ran'] ? (
        <div className="alert info" role="status">
          <strong>
            {tr('admin.finance.runResult', {
              paid: Number(params['paid'] ?? 0),
              failed: Number(params['failed'] ?? 0),
              eligible: Number(params['eligible'] ?? 0),
            })}
          </strong>
          {skipped.length > 0 ? (
            <ul style={{ margin: '8px 0 0' }}>
              {skipped.map((s) => (
                <li key={s}>
                  {tr(`admin.finance.skip.${s}`)}: {Number(params[`skip_${s}`])}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {manage ? (
        <form action={runPayouts} className="card" style={{ maxWidth: 640, marginBlockEnd: 16 }}>
          <input type="hidden" name="back" value="/admin/finance/payouts" />
          <h2 style={{ margin: 0 }}>{tr('admin.finance.runPayouts')}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {tr('admin.finance.runPayoutsHint')}
          </p>
          <button className="btn" type="submit">
            {tr('admin.finance.runPayouts')}
          </button>
        </form>
      ) : null}

      <h2>{tr('admin.finance.holds')}</h2>
      {active.length === 0 ? (
        <p className="muted">{tr('admin.finance.noHolds')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.product.store')}</th>
                <th>{tr('admin.finance.reason')}</th>
                <th>{tr('admin.finance.placedBy')}</th>
                {manage ? (
                  <th>
                    <span className="sr-only">{tr('admin.finance.release')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {active.map((h) => (
                <tr key={h.id}>
                  <td>{h.business.name[locale]}</td>
                  <td>{h.reason}</td>
                  <td>
                    {h.placedBy?.name ?? '—'}
                    <div className="muted">{when(h.createdAt)}</div>
                  </td>
                  {manage ? (
                    <td>
                      <form action={releaseHold}>
                        <input type="hidden" name="holdId" value={h.id} />
                        <input type="hidden" name="back" value={back} />
                        <button className="btn secondary" type="submit">
                          {tr('admin.finance.release')}
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage ? (
        <form action={placeHold} className="inline-form" style={{ marginBlock: 12 }}>
          <input type="hidden" name="back" value={back} />
          <label className="sr-only" htmlFor="hold-business">
            {tr('admin.finance.businessId')}
          </label>
          <input
            id="hold-business"
            name="businessId"
            required
            className="ltr"
            placeholder={tr('admin.finance.businessId')}
            style={{ minWidth: 300 }}
          />
          <label className="sr-only" htmlFor="hold-reason">
            {tr('admin.finance.reason')}
          </label>
          <input
            id="hold-reason"
            name="reason"
            type="text"
            required
            minLength={3}
            maxLength={500}
            placeholder={tr('admin.finance.reason')}
          />
          <button className="btn danger" type="submit">
            {tr('admin.finance.placeHold')}
          </button>
        </form>
      ) : null}

      <h2>{tr('admin.finance.payoutHistory')}</h2>
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/finance/payouts?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {f === 'all' ? tr('admin.bookings.all') : tr(`payout.status.${f}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.finance.noPayouts')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.finance.payout')}</th>
                <th>{tr('admin.product.store')}</th>
                <th>{tr('admin.finance.amount')}</th>
                <th>{tr('admin.bookings.status')}</th>
                <th>{tr('admin.finance.date')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <ShortId id={p.id} />
                    <div className="muted">
                      {tr('admin.finance.earningCount', { n: p.earningCount })}
                    </div>
                  </td>
                  <td>{p.business.name[locale]}</td>
                  <td>{money(p.amountFils, locale)}</td>
                  <td>
                    <span className={`badge payout-${p.status}`}>
                      {tr(`payout.status.${p.status}`)}
                    </span>
                    {p.failureCode ? <div className="muted ltr-inline">{p.failureCode}</div> : null}
                    {p.needsAttention ? (
                      <div>
                        <span className="badge rejected">{tr('admin.finance.needsAttention')}</span>
                      </div>
                    ) : null}
                  </td>
                  <td>{when(p.paidAt ?? p.failedAt ?? p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager href={back} cursor={page.nextCursor} locale={locale} />
    </Shell>
  );
}
