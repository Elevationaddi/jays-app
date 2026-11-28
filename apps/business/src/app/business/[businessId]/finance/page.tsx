import type { MessageKey } from '@jays/i18n';
import Link from 'next/link';
import { documentTitle } from '../../../../components/TaxDocumentView';
import { Workspace, loadBusiness, money } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { startPayoutOnboarding } from '../finance-actions';

type Search = Promise<Record<string, string | undefined>>;
const VIEWS = ['earnings', 'payouts', 'ledger', 'documents'] as const;

/**
 * Read-only finance view (docs/03-business.md, /business/finance): what the business is owed,
 * what is on its way, and the lines behind it. Owners and finance members (`finance.view`).
 */
export default async function FinancePage({
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
  const path = `/business/${businessId}/finance`;
  const frame = { locale, business, tab: 'finance' as const, path, title: tr('finance.title') };
  if (!business.myCapabilities.includes('finance.view')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const view = (VIEWS as readonly string[]).includes(query['view'] ?? '')
    ? (query['view'] as (typeof VIEWS)[number])
    : 'earnings';
  const api = await serverApi();
  const page = { limit: 50, ...(query['cursor'] ? { cursor: query['cursor'] } : {}) };
  // Back from the provider's onboarding: read the account's status from the provider again.
  const returning = query['payoutAccount'] === 'return';
  const [summary, account, earnings, payouts, ledger, documents, pilot] = await Promise.all([
    api.financeSummary(businessId),
    (returning ? api.refreshPayoutAccount(businessId) : api.payoutAccount(businessId)).catch(
      () => null,
    ),
    view === 'earnings' ? api.financeEarnings(businessId, page) : null,
    view === 'payouts' ? api.financePayouts(businessId, page) : null,
    view === 'ledger' ? api.financeLedger(businessId, page) : null,
    view === 'documents' ? api.businessDocuments(businessId, page) : null,
    api.pilotPromotion(businessId).catch(() => null),
  ]);
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  const when = (iso: string | null) => (iso ? date.format(new Date(iso)) : '—');
  const nextCursor =
    earnings?.nextCursor ??
    payouts?.nextCursor ??
    ledger?.nextCursor ??
    documents?.nextCursor ??
    null;
  const figures: [MessageKey, number, MessageKey][] = [
    ['finance.payable', summary.payableBalanceFils, 'finance.payableHint'],
    ['finance.eligible', summary.eligibleFils, 'finance.eligibleHint'],
    ['finance.pending', summary.pendingFils, 'finance.pendingHint'],
    ['finance.inTransit', summary.inTransitFils, 'finance.inTransitHint'],
    ['finance.paidOut', summary.paidOutFils, 'finance.paidOutHint'],
    ['finance.commission', summary.commissionFils, 'finance.commissionHint'],
  ];
  return (
    <Workspace
      {...frame}
      intro={tr('finance.intro', { days: summary.disputeWindowDays })}
      error={query['error']}
    >
      {pilot?.promotion &&
      (pilot.promotion.state === 'active' || pilot.promotion.state === 'scheduled') ? (
        <div className="alert info" role="status" style={{ marginBottom: 16 }}>
          <strong>{tr('finance.pilot.title')}</strong>{' '}
          {tr(
            pilot.promotion.state === 'active' ? 'finance.pilot.active' : 'finance.pilot.scheduled',
            {
              start: when(pilot.promotion.startsAt),
              end: when(pilot.promotion.endsAt),
              days: pilot.promotion.daysLeft,
              rate:
                [...new Set([pilot.standardBps.shop, pilot.standardBps.services])]
                  .filter((b): b is number => b !== null)
                  .map((b) => `${b / 100}%`)
                  .join(' / ') || '—',
            },
          )}
        </div>
      ) : null}
      {account ? (
        <section className="card" aria-labelledby="payout-account" style={{ marginBottom: 16 }}>
          <h2 id="payout-account">{tr('finance.payoutAccount.title')}</h2>
          {!account.required ? (
            <p className="muted">{tr('finance.payoutAccount.mock')}</p>
          ) : (
            <>
              <p>
                <span
                  className={`badge ${{ enabled: 'active', pending: 'onboarding', none: 'not_activated' }[account.status]}`}
                >
                  {tr(`finance.payoutAccount.status.${account.status}`)}
                </span>
              </p>
              <p className="muted">{tr(`finance.payoutAccount.hint.${account.status}`)}</p>
              {query['payoutAccount'] === 'refresh' ? (
                <div className="alert info" role="status">
                  {tr('finance.payoutAccount.expired')}
                </div>
              ) : null}
              {account.status !== 'enabled' &&
              business.myCapabilities.includes('onboarding.manage') ? (
                <form action={startPayoutOnboarding}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <button type="submit" className="primary">
                    {tr(
                      account.status === 'none'
                        ? 'finance.payoutAccount.start'
                        : 'finance.payoutAccount.continue',
                    )}
                  </button>
                </form>
              ) : null}
              <p className="muted" style={{ fontSize: 13 }}>
                {tr('finance.payoutAccount.privacy')}
              </p>
            </>
          )}
        </section>
      ) : null}
      {summary.onHold ? (
        <div className="alert error" role="status">
          {tr('finance.onHold')}
        </div>
      ) : null}
      {summary.openDisputes > 0 ? (
        <div className="alert info" role="status">
          {tr('finance.openDisputes', { n: summary.openDisputes })}
        </div>
      ) : null}
      <div className="stats">
        {figures.map(([label, value, hint]) => (
          <section key={label} className="card stat">
            <span className="muted">{tr(label)}</span>
            <strong className={value < 0 ? 'negative' : undefined}>{money(value, locale)}</strong>
            <small className="muted">{tr(hint)}</small>
          </section>
        ))}
      </div>

      <nav className="tabs filters" aria-label={tr('finance.title')} style={{ marginTop: 24 }}>
        {VIEWS.map((v) => (
          <Link key={v} href={`${path}?view=${v}`} aria-current={view === v ? 'page' : undefined}>
            {tr(`finance.view.${v}`)}
          </Link>
        ))}
      </nav>

      {earnings ? (
        earnings.items.length === 0 ? (
          <p className="muted">{tr('finance.noEarnings')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('finance.date')}</th>
                  <th>{tr('finance.for')}</th>
                  <th>{tr('finance.gross')}</th>
                  <th>{tr('finance.commission')}</th>
                  <th>{tr('finance.net')}</th>
                  <th>{tr('finance.status')}</th>
                </tr>
              </thead>
              <tbody>
                {earnings.items.map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.createdAt)}</td>
                    <td>
                      {e.sourceType === 'booking' ? (
                        tr('finance.booking')
                      ) : (
                        <Link href={`/business/${businessId}/orders/${e.merchantOrderId}`}>
                          <span className="ltr">
                            #{(e.orderId ?? '').slice(0, 8).toUpperCase()}
                          </span>
                        </Link>
                      )}
                    </td>
                    <td>
                      {money(e.grossFils, locale)}
                      {e.refundedFils > 0 ? (
                        <div className="muted">
                          {tr('finance.refundedAmount', { amount: money(e.refundedFils, locale) })}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {money(e.commissionFils, locale)}
                      <div className="muted">
                        <bdi>{(e.commissionBps / 100).toFixed(2)}%</bdi>
                      </div>
                      {e.commissionVatFils > 0 ? (
                        <div className="muted">
                          {tr('finance.commissionVat', {
                            amount: money(e.commissionVatFils, locale),
                          })}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <strong>{money(e.netFils, locale)}</strong>
                    </td>
                    <td>
                      <span className={`badge earning-${e.status}`}>
                        {tr(`earning.status.${e.status}`)}
                      </span>
                      {e.disputed ? (
                        <div>
                          <span className="badge rejected">{tr('finance.disputed')}</span>
                        </div>
                      ) : null}
                      {e.status === 'pending' && e.eligibleAt ? (
                        <div className="muted">
                          {tr('finance.eligibleFrom', { date: when(e.eligibleAt) })}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {documents ? (
        documents.items.length === 0 ? (
          <p className="muted">{tr('tax.noDocuments')}</p>
        ) : (
          <div className="table-wrap">
            <p className="muted">{tr('finance.documentsIntro')}</p>
            <table>
              <thead>
                <tr>
                  <th>{tr('finance.date')}</th>
                  <th>{tr('finance.document')}</th>
                  <th>{tr('tax.vat')}</th>
                  <th>{tr('tax.total')}</th>
                </tr>
              </thead>
              <tbody>
                {documents.items.map((d) => (
                  <tr key={d.id}>
                    <td>{when(d.issuedAt)}</td>
                    <td>
                      <Link href={`${path}/documents/${d.id}`}>
                        <span className="ltr">{d.number}</span>
                      </Link>
                      <div className="muted">
                        {documentTitle(locale, d)} ·{' '}
                        {tr(
                          d.issuer === 'platform' ? 'finance.docFromJays' : 'finance.docToCustomer',
                        )}
                      </div>
                    </td>
                    <td>{money(d.vatFils, locale)}</td>
                    <td>
                      <strong>{money(d.totalFils, locale)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {payouts ? (
        payouts.items.length === 0 ? (
          <p className="muted">{tr('finance.noPayouts')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('finance.date')}</th>
                  <th>{tr('finance.amount')}</th>
                  <th>{tr('finance.status')}</th>
                  <th>{tr('finance.reference')}</th>
                </tr>
              </thead>
              <tbody>
                {payouts.items.map((p) => (
                  <tr key={p.id}>
                    <td>{when(p.paidAt ?? p.failedAt ?? p.createdAt)}</td>
                    <td>
                      <strong>{money(p.amountFils, locale)}</strong>
                      <div className="muted">
                        {tr('finance.earningCount', { n: p.earningCount })}
                      </div>
                    </td>
                    <td>
                      <span className={`badge payout-${p.status}`}>
                        {tr(`payout.status.${p.status}`)}
                      </span>
                      {p.status === 'failed' ? (
                        <div className="muted">{tr('finance.payoutFailedHint')}</div>
                      ) : null}
                    </td>
                    <td>
                      <code className="ltr">{p.id.slice(0, 8).toUpperCase()}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {ledger ? (
        ledger.items.length === 0 ? (
          <p className="muted">{tr('finance.noLedger')}</p>
        ) : (
          <>
            <p className="muted">{tr('finance.ledgerIntro')}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr('finance.date')}</th>
                    <th>{tr('finance.entry')}</th>
                    <th>{tr('finance.account')}</th>
                    <th>{tr('finance.in')}</th>
                    <th>{tr('finance.out')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.items.map((l) => (
                    <tr key={l.id}>
                      <td>{when(l.occurredAt)}</td>
                      <td>{tr(`ledger.kind.${l.kind}`)}</td>
                      <td>{tr(`ledger.account.${l.account}`)}</td>
                      <td>{l.creditFils > 0 ? money(l.creditFils, locale) : '—'}</td>
                      <td>{l.debitFils > 0 ? money(l.debitFils, locale) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}

      {nextCursor ? (
        <p>
          <Link href={`${path}?view=${view}&cursor=${encodeURIComponent(nextCursor)}`}>
            {tr('common.next')} →
          </Link>
        </p>
      ) : null}
    </Workspace>
  );
}
