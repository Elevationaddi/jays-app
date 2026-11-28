import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { openDispute } from '../actions';
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

const FILTERS = ['all', 'pending', 'eligible', 'in_payout', 'paid_out'] as const;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function EarningsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance/earnings');
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
  const businessId = UUID.test(params['businessId'] ?? '') ? params['businessId'] : undefined;
  const page = await api.adminEarnings({
    limit: 50,
    ...(status !== 'all' ? { status } : {}),
    ...(businessId ? { businessId } : {}),
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = dateTime(locale);
  const manage = can(admin, 'finance.manage');
  const base = `/admin/finance/earnings?status=${status}${businessId ? `&businessId=${businessId}` : ''}`;
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.finance.earnings')}</h1>
      <p className="muted">{tr('admin.finance.earningsIntro')}</p>
      <FinanceTabs locale={locale} current="earnings" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/finance/earnings?status=${f}${businessId ? `&businessId=${businessId}` : ''}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {f === 'all' ? tr('admin.bookings.all') : tr(`earning.status.${f}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.finance.noEarnings')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.product.store')}</th>
                <th>{tr('admin.finance.for')}</th>
                <th>{tr('admin.finance.gross')}</th>
                <th>{tr('admin.finance.commission')}</th>
                <th>{tr('admin.finance.net')}</th>
                <th>{tr('admin.bookings.status')}</th>
                {manage ? <th>{tr('admin.finance.openDispute')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {page.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/admin/finance/earnings?businessId=${e.business.id}`}>
                      {e.business.name[locale]}
                    </Link>
                    <div className="muted">{when(e.createdAt)}</div>
                  </td>
                  <td>
                    {tr(
                      e.sourceType === 'booking' ? 'admin.finance.booking' : 'admin.finance.order',
                    )}{' '}
                    <ShortId id={e.bookingId ?? e.orderId} />
                  </td>
                  <td>
                    {money(e.grossFils, locale)}
                    {e.refundedFils > 0 ? (
                      <div className="muted">
                        {tr('admin.finance.refundedAmount', {
                          amount: money(e.refundedFils, locale),
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {money(e.commissionFils, locale)}
                    <div className="muted">
                      <bdi>{(e.commissionBps / 100).toFixed(2)}%</bdi>
                    </div>
                  </td>
                  <td>{money(e.netFils, locale)}</td>
                  <td>
                    <span className={`badge earning-${e.status}`}>
                      {tr(`earning.status.${e.status}`)}
                    </span>
                    {e.disputed ? (
                      <div>
                        <span className="badge rejected">{tr('admin.finance.disputed')}</span>
                      </div>
                    ) : null}
                    {e.status === 'pending' && e.eligibleAt ? (
                      <div className="muted">
                        {tr('admin.finance.eligibleFrom', { date: when(e.eligibleAt) })}
                      </div>
                    ) : null}
                  </td>
                  {manage ? (
                    <td>
                      {!e.disputed && e.netFils > 0 ? (
                        <form action={openDispute} className="inline-form">
                          <input type="hidden" name="earningId" value={e.id} />
                          <input type="hidden" name="back" value={base} />
                          <label className="sr-only" htmlFor={`d-amount-${e.id}`}>
                            {tr('admin.finance.amountAed')}
                          </label>
                          <input
                            id={`d-amount-${e.id}`}
                            name="amount"
                            inputMode="decimal"
                            required
                            className="ltr"
                            placeholder={tr('admin.finance.amountAed')}
                            style={{ width: 100 }}
                          />
                          <label className="sr-only" htmlFor={`d-reason-${e.id}`}>
                            {tr('admin.finance.reason')}
                          </label>
                          <input
                            id={`d-reason-${e.id}`}
                            name="reason"
                            type="text"
                            required
                            minLength={3}
                            maxLength={500}
                            placeholder={tr('admin.finance.reason')}
                          />
                          <button className="btn secondary" type="submit">
                            {tr('admin.finance.openDispute')}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager href={base} cursor={page.nextCursor} locale={locale} />
    </Shell>
  );
}
