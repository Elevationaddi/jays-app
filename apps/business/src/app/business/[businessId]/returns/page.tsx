import Link from 'next/link';
import { Workspace, loadBusiness, money } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { returnAction } from '../aftercare-actions';

type Search = Promise<Record<string, string | undefined>>;
const STATUSES = ['requested', 'approved', 'received', 'refund_pending', 'refunded', 'rejected'];

/**
 * Returns (docs/03-business.md; ADR-0016): approve or reject a request, then mark the goods
 * received, which refunds what those units paid. Restocking is a separate inventory adjustment.
 */
export default async function ReturnsPage({
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
  const path = `/business/${businessId}/returns`;
  const frame = { locale, business, tab: 'returns' as const, path, title: tr('returns.title') };
  if (!business.myCapabilities.includes('returns.manage')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const status = STATUSES.includes(query['status'] ?? '') ? query['status'] : undefined;
  const page = await (
    await serverApi()
  ).businessReturns(businessId, {
    limit: 50,
    ...(status ? { status } : {}),
    ...(query['cursor'] ? { cursor: query['cursor'] } : {}),
  });
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Workspace
      {...frame}
      intro={tr('returns.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('returns.saved') : undefined}
    >
      <nav className="tabs" aria-label={tr('returns.filter')}>
        <Link href={path} aria-current={!status ? 'page' : undefined}>
          {tr('returns.all')}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`${path}?status=${s}`}
            aria-current={status === s ? 'page' : undefined}
          >
            {tr(`returnStatus.${s as 'requested'}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? <p className="muted">{tr('returns.empty')}</p> : null}
      <div className="stack">
        {page.items.map((r) => (
          <section key={r.id} className="card">
            <p className="meta">
              <Link href={`/business/${businessId}/orders/${r.merchantOrderId}`}>
                #{r.orderId.slice(0, 8).toUpperCase()}
              </Link>
              <span className={`badge ${r.status}`}>{tr(`returnStatus.${r.status}`)}</span>
              <span className="muted">{date.format(new Date(r.createdAt))}</span>
              <strong>{money(r.amountFils, locale)}</strong>
            </p>
            <ul>
              {r.items.map((i) => (
                <li key={i.orderItemId}>
                  {i.title[locale]} · {i.variantName[locale]} × {i.qty} (
                  {money(i.amountFils, locale)})
                </li>
              ))}
            </ul>
            <p>
              <span className="muted">{tr('returns.customerReason')}:</span> {r.reason}
            </p>
            {r.decisionReason ? (
              <p>
                <span className="muted">{tr('returns.decisionReason')}:</span> {r.decisionReason}
              </p>
            ) : null}
            {r.status === 'requested' ? (
              <div className="inline-form">
                <form action={returnAction}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="returnId" value={r.id} />
                  <input type="hidden" name="action" value="approve" />
                  <button className="btn">{tr('returns.approve')}</button>
                </form>
                <form action={returnAction} className="inline-form">
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="returnId" value={r.id} />
                  <input type="hidden" name="action" value="reject" />
                  <label className="sr-only" htmlFor={`reason-${r.id}`}>
                    {tr('returns.rejectReason')}
                  </label>
                  <input
                    id={`reason-${r.id}`}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    placeholder={tr('returns.rejectReason')}
                  />
                  <button className="btn secondary">{tr('returns.reject')}</button>
                </form>
              </div>
            ) : null}
            {r.status === 'approved' ? (
              <form action={returnAction} className="inline-form">
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="returnId" value={r.id} />
                <input type="hidden" name="action" value="receive" />
                <button className="btn">{tr('returns.receive')}</button>
                <span className="muted">{tr('returns.receiveHint')}</span>
              </form>
            ) : null}
          </section>
        ))}
      </div>
      {page.nextCursor ? (
        <p>
          <Link
            href={`${path}?${new URLSearchParams({ ...(status ? { status } : {}), cursor: page.nextCursor })}`}
          >
            {tr('common.more')}
          </Link>
        </p>
      ) : null}
    </Workspace>
  );
}
