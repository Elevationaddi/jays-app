import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import { resolveReconciliationItem, runReconciliation } from '../actions';
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

export default async function ReconciliationPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance/reconciliation');
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const page = await api.adminReconciliationRuns({
    limit: 10,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = dateTime(locale);
  const manage = can(admin, 'finance.manage');
  const back = '/admin/finance/reconciliation';
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.finance.reconciliation')}</h1>
      <p className="muted">{tr('admin.finance.reconIntro')}</p>
      <FinanceTabs locale={locale} current="reconciliation" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />
      {manage ? (
        <form action={runReconciliation} className="inline-form" style={{ marginBlockEnd: 16 }}>
          <input type="hidden" name="back" value={back} />
          <label htmlFor="recon-date">{tr('admin.finance.recon.day')}</label>
          <input id="recon-date" name="date" type="date" max={yesterday} defaultValue={yesterday} />
          <button className="btn" type="submit">
            {tr('admin.finance.recon.run')}
          </button>
        </form>
      ) : null}
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.finance.recon.none')}</p>
      ) : (
        page.items.map((run) => (
          <section key={run.id} className="card" style={{ marginBlockEnd: 16 }}>
            <div className="meta">
              <h2 style={{ margin: 0 }}>
                <bdi>{run.periodStart.slice(0, 10)}</bdi>
              </h2>
              <span className={`badge recon-${run.status}`}>
                {tr(`admin.finance.recon.status.${run.status}`)}
              </span>
              <span className="muted">
                {tr('admin.finance.recon.counts', {
                  checked: run.checkedCount,
                  recovered: run.recoveredCount,
                  mismatches: run.mismatchCount,
                })}
              </span>
            </div>
            <div className="muted">
              {run.startedBy?.name ?? tr('admin.finance.system')} · {when(run.startedAt)}
            </div>
            {run.failure ? <div className="alert error">{run.failure}</div> : null}
            {run.items.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{tr('admin.finance.recon.finding')}</th>
                      <th>{tr('admin.finance.recon.ours')}</th>
                      <th>{tr('admin.finance.recon.provider')}</th>
                      <th>{tr('admin.finance.recon.handled')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.items.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <strong>{tr(`admin.finance.recon.kind.${i.kind}`)}</strong>
                          <div className="muted">
                            {tr(`admin.finance.recon.object.${i.objectType}`)}{' '}
                            <ShortId id={i.paymentId ?? i.refundId ?? i.payoutId} />
                            {i.providerRef ? (
                              <>
                                {' · '}
                                <code className="ltr-inline">{i.providerRef}</code>
                              </>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {i.localAmountFils !== null ? money(i.localAmountFils, locale) : '—'}
                          {i.localStatus ? (
                            <div className="muted ltr-inline">{i.localStatus}</div>
                          ) : null}
                        </td>
                        <td>
                          {i.providerAmountFils !== null
                            ? money(i.providerAmountFils, locale)
                            : '—'}
                          {i.providerStatus ? (
                            <div className="muted ltr-inline">{i.providerStatus}</div>
                          ) : null}
                        </td>
                        <td>
                          {i.resolvedAt ? (
                            <>
                              <span className="badge active">
                                {tr('admin.finance.recon.resolved')}
                              </span>
                              <div className="muted">
                                {i.resolvedBy?.name ?? tr('admin.finance.system')}
                                {i.resolutionNote ? ` · ${i.resolutionNote}` : ''}
                              </div>
                            </>
                          ) : manage ? (
                            <form action={resolveReconciliationItem} className="inline-form">
                              <input type="hidden" name="itemId" value={i.id} />
                              <input type="hidden" name="back" value={back} />
                              <label className="sr-only" htmlFor={`note-${i.id}`}>
                                {tr('admin.finance.note')}
                              </label>
                              <input
                                id={`note-${i.id}`}
                                name="note"
                                type="text"
                                required
                                minLength={3}
                                maxLength={500}
                                placeholder={tr('admin.finance.note')}
                              />
                              <button className="btn secondary" type="submit">
                                {tr('admin.finance.recon.markHandled')}
                              </button>
                            </form>
                          ) : (
                            <span className="badge held">{tr('admin.finance.recon.open')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {tr('admin.finance.recon.clean')}
              </p>
            )}
          </section>
        ))
      )}
      <Pager href={back} cursor={page.nextCursor} locale={locale} />
    </Shell>
  );
}
