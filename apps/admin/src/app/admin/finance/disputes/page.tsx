import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { resolveDispute } from '../actions';
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

const FILTERS = ['open', 'won', 'lost', 'all'] as const;

export default async function DisputesPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance/disputes');
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const status = (FILTERS as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as (typeof FILTERS)[number])
    : 'open';
  const page = await api.adminDisputes({
    limit: 50,
    ...(status !== 'all' ? { status } : {}),
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = dateTime(locale);
  const manage = can(admin, 'finance.manage');
  const back = `/admin/finance/disputes?status=${status}`;
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.finance.disputes')}</h1>
      <p className="muted">{tr('admin.finance.disputesIntro')}</p>
      <FinanceTabs locale={locale} current="disputes" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/finance/disputes?status=${f}`}
            aria-current={status === f ? 'page' : undefined}
          >
            {f === 'all' ? tr('admin.bookings.all') : tr(`admin.finance.dispute.${f}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.finance.noDisputes')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.product.store')}</th>
                <th>{tr('admin.finance.amount')}</th>
                <th>{tr('admin.finance.reason')}</th>
                <th>{tr('admin.bookings.status')}</th>
                {manage ? (
                  <th>
                    <span className="sr-only">{tr('admin.finance.resolve')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {page.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.business.name[locale]}
                    <div className="muted">
                      {tr('admin.finance.earning')} <ShortId id={d.earningId} />
                    </div>
                  </td>
                  <td>{money(d.amountFils, locale)}</td>
                  <td>
                    {d.reason}
                    <div className="muted">
                      {d.openedBy?.name ?? '—'} · {when(d.createdAt)}
                    </div>
                  </td>
                  <td>
                    <span className={`badge dispute-${d.status}`}>
                      {tr(`admin.finance.dispute.${d.status}`)}
                    </span>
                    {d.resolutionNote ? (
                      <div className="muted">
                        {d.resolutionNote}
                        {d.resolvedBy ? ` · ${d.resolvedBy.name}` : ''}
                      </div>
                    ) : null}
                  </td>
                  {manage ? (
                    <td>
                      {d.status === 'open' ? (
                        <form action={resolveDispute} className="inline-form">
                          <input type="hidden" name="disputeId" value={d.id} />
                          <input type="hidden" name="back" value={back} />
                          <label className="sr-only" htmlFor={`note-${d.id}`}>
                            {tr('admin.finance.note')}
                          </label>
                          <input
                            id={`note-${d.id}`}
                            name="note"
                            type="text"
                            required
                            minLength={3}
                            maxLength={500}
                            placeholder={tr('admin.finance.note')}
                          />
                          <button
                            className="btn secondary"
                            type="submit"
                            name="outcome"
                            value="won"
                          >
                            {tr('admin.finance.markWon')}
                          </button>
                          <button className="btn danger" type="submit" name="outcome" value="lost">
                            {tr('admin.finance.markLost')}
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
      {manage ? <p className="muted">{tr('admin.finance.lostHint')}</p> : null}
      <Pager href={back} cursor={page.nextCursor} locale={locale} />
    </Shell>
  );
}
