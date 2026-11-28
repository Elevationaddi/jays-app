import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { decideRefund } from '../actions';
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

const FILTERS = ['pending_approval', 'approved', 'rejected', 'all'] as const;

export default async function RefundsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance/refunds');
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const status = (FILTERS as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as (typeof FILTERS)[number])
    : 'pending_approval';
  const page = await api.adminRefundRequests({
    limit: 50,
    ...(status !== 'all' ? { status } : {}),
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = dateTime(locale);
  const decide = can(admin, 'finance.refund');
  const back = `/admin/finance/refunds?status=${status}`;
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.finance.refunds')}</h1>
      <p className="muted">{tr('admin.finance.refundsIntro')}</p>
      <FinanceTabs locale={locale} current="refunds" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/finance/refunds?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {f === 'all' ? tr('admin.bookings.all') : tr(`admin.finance.request.${f}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.finance.noRefunds')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.finance.payment')}</th>
                <th>{tr('admin.finance.amount')}</th>
                <th>{tr('admin.finance.reason')}</th>
                <th>{tr('admin.finance.requestedBy')}</th>
                <th>{tr('admin.bookings.status')}</th>
                {decide ? (
                  <th>
                    <span className="sr-only">{tr('admin.finance.decision')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {page.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/finance/payments/${r.paymentId}`}>
                      <ShortId id={r.paymentId} />
                    </Link>
                    {r.business ? <div className="muted">{r.business.name[locale]}</div> : null}
                  </td>
                  <td>
                    {money(r.amountFils, locale)}
                    {r.needsSecondApproval ? (
                      <div className="muted">
                        {tr('admin.finance.aboveThreshold', {
                          amount: money(r.thresholdFils, locale),
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td>{r.reason}</td>
                  <td>
                    {r.requestedBy?.name ?? '—'}
                    <div className="muted">{when(r.createdAt)}</div>
                  </td>
                  <td>
                    <span className={`badge ${r.status}`}>
                      {tr(`admin.finance.request.${r.status}`)}
                    </span>
                    {r.refund ? (
                      <div className="muted">{tr(`admin.finance.refund.${r.refund.status}`)}</div>
                    ) : null}
                    {r.decidedAt ? (
                      <div className="muted">
                        {r.decidedBy
                          ? tr('admin.finance.decidedBy', { name: r.decidedBy.name })
                          : tr('admin.finance.withdrawn')}
                        {r.decisionNote ? ` · ${r.decisionNote}` : ''}
                      </div>
                    ) : null}
                  </td>
                  {decide ? (
                    <td>
                      {r.status === 'pending_approval' ? (
                        <form action={decideRefund} className="inline-form">
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="back" value={back} />
                          <label className="sr-only" htmlFor={`note-${r.id}`}>
                            {tr('admin.finance.note')}
                          </label>
                          <input
                            id={`note-${r.id}`}
                            name="note"
                            type="text"
                            maxLength={500}
                            placeholder={tr('admin.finance.note')}
                          />
                          {r.requestedBy?.id !== admin.id ? (
                            <button className="btn" type="submit" name="decision" value="approve">
                              {tr('admin.finance.approve')}
                            </button>
                          ) : null}
                          <button
                            className="btn secondary"
                            type="submit"
                            name="decision"
                            value="reject"
                          >
                            {r.requestedBy?.id === admin.id
                              ? tr('admin.finance.withdraw')
                              : tr('admin.finance.reject')}
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
      <Pager href={back} cursor={page.nextCursor} locale={locale} />
    </Shell>
  );
}
