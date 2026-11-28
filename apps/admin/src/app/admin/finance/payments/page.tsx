import type { MessageKey } from '@jays/i18n';
import Link from 'next/link';
import { ErrorAlert } from '../../../../components/ErrorAlert';
import { Shell } from '../../../../components/Shell';
import { requireAdmin } from '../../../../lib/admin';
import { translator } from '../../../../lib/i18n';
import {
  can,
  dateTime,
  FinanceTabs,
  Forbidden,
  money,
  Pager,
  ShortId,
  type Search,
} from '../shared';

const FILTERS = [
  'all',
  'attention',
  'succeeded',
  'partially_refunded',
  'refunded',
  'refund_failed',
] as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/finance/payments');
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  const filter: (typeof FILTERS)[number] = params['attention']
    ? 'attention'
    : (FILTERS as readonly string[]).includes(params['status'] ?? '')
      ? (params['status'] as (typeof FILTERS)[number])
      : 'all';
  const page = await api.adminPayments({
    limit: 50,
    ...(filter === 'attention' ? { needsAttention: 'true' as const } : {}),
    ...(filter !== 'all' && filter !== 'attention' ? { status: filter } : {}),
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = dateTime(locale);
  const hrefOf = (f: (typeof FILTERS)[number]) =>
    f === 'all'
      ? '/admin/finance/payments'
      : f === 'attention'
        ? '/admin/finance/payments?attention=1'
        : `/admin/finance/payments?status=${f}`;
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <h1>{tr('admin.finance.payments')}</h1>
      <FinanceTabs locale={locale} current="payments" />
      <ErrorAlert locale={locale} code={params['error']} />
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        {FILTERS.map((f) => (
          <Link key={f} href={hrefOf(f)} aria-current={filter === f ? 'page' : undefined}>
            {f === 'all'
              ? tr('admin.bookings.all')
              : f === 'attention'
                ? tr('admin.finance.needsAttention')
                : tr(`payment.status.${f}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.finance.noPayments')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('admin.finance.payment')}</th>
                <th>{tr('admin.finance.for')}</th>
                <th>{tr('admin.finance.amount')}</th>
                <th>{tr('admin.finance.refunded')}</th>
                <th>{tr('admin.bookings.status')}</th>
                <th>{tr('admin.finance.date')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/finance/payments/${p.id}`}>
                      <ShortId id={p.id} />
                    </Link>
                  </td>
                  <td>
                    {tr(p.targetType === 'order' ? 'admin.finance.order' : 'admin.finance.booking')}
                    <div className="muted">
                      {p.sellers
                        .map((s) => s.business.name[locale])
                        .join(locale === 'ar' ? '، ' : ', ')}
                    </div>
                  </td>
                  <td>{money(p.amountFils, locale)}</td>
                  <td>
                    {p.refundedFils > 0 ? money(p.refundedFils, locale) : '—'}
                    {p.pendingRefundFils > 0 ? (
                      <div className="muted">
                        {tr('admin.finance.pendingAmount', {
                          amount: money(p.pendingRefundFils, locale),
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`badge ${p.status}`}>
                      {tr(`payment.status.${p.status}` as MessageKey)}
                    </span>
                    {p.needsAttention ? (
                      <div>
                        <span className="badge rejected">{tr('admin.finance.needsAttention')}</span>
                      </div>
                    ) : null}
                  </td>
                  <td>{when(p.succeededAt ?? p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager href={hrefOf(filter)} cursor={page.nextCursor} locale={locale} />
    </Shell>
  );
}
