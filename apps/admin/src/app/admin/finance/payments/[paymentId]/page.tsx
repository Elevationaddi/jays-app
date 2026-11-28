import { ApiClientError } from '@jays/api-client';
import type { MessageKey } from '@jays/i18n';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorAlert } from '../../../../../components/ErrorAlert';
import { Shell } from '../../../../../components/Shell';
import { requireAdmin } from '../../../../../lib/admin';
import { translator } from '../../../../../lib/i18n';
import { requestRefund } from '../../actions';
import {
  can,
  dateTime,
  FinanceTabs,
  Forbidden,
  money,
  Notice,
  ShortId,
  type Search,
} from '../../shared';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function PaymentPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Search;
}) {
  const { paymentId } = await routeParams;
  const params = await searchParams;
  const { locale, tr } = await translator();
  const back = `/admin/finance/payments/${paymentId}`;
  const { api, admin } = await requireAdmin(back);
  if (!can(admin, 'finance.view')) {
    return (
      <Shell locale={locale} admin={admin} current="finance">
        <Forbidden locale={locale} />
      </Shell>
    );
  }
  if (!UUID.test(paymentId)) notFound();
  const payment = await api.adminPayment(paymentId).catch((error: unknown) => {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  });
  const when = dateTime(locale);
  const refund = can(admin, 'finance.refund');
  return (
    <Shell locale={locale} admin={admin} current="finance">
      <p>
        <Link href="/admin/finance/payments">← {tr('admin.finance.payments')}</Link>
      </p>
      <h1>
        {tr('admin.finance.payment')} <ShortId id={payment.id} />
      </h1>
      <FinanceTabs locale={locale} current="payments" />
      <ErrorAlert locale={locale} code={params['error']} />
      <Notice locale={locale} params={params} />
      <section className="card" style={{ maxWidth: 720 }}>
        <dl className="kv">
          <dt>{tr('admin.finance.for')}</dt>
          <dd>
            {tr(payment.targetType === 'order' ? 'admin.finance.order' : 'admin.finance.booking')}{' '}
            <ShortId id={payment.orderId ?? payment.bookingId} />
          </dd>
          <dt>{tr('admin.bookings.status')}</dt>
          <dd>
            <span className={`badge ${payment.status}`}>
              {tr(`payment.status.${payment.status}` as MessageKey)}
            </span>
            {payment.needsAttention ? (
              <span className="badge rejected" style={{ marginInlineStart: 8 }}>
                {tr('admin.finance.needsAttention')}
              </span>
            ) : null}
          </dd>
          <dt>{tr('admin.finance.amount')}</dt>
          <dd>{money(payment.amountFils, locale)}</dd>
          <dt>{tr('admin.finance.refunded')}</dt>
          <dd>{money(payment.refundedFils, locale)}</dd>
          <dt>{tr('admin.finance.refundPending')}</dt>
          <dd>{money(payment.pendingRefundFils, locale)}</dd>
          <dt>{tr('admin.finance.paidAt')}</dt>
          <dd>{when(payment.succeededAt)}</dd>
          <dt>{tr('admin.finance.providerRef')}</dt>
          <dd>
            <code className="ltr-inline">{payment.providerRef ?? '—'}</code>
          </dd>
        </dl>
      </section>

      <h2>{tr('admin.finance.sellers')}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tr('admin.product.store')}</th>
              <th>{tr('admin.finance.gross')}</th>
              <th>{tr('admin.finance.refundable')}</th>
              {refund ? <th>{tr('admin.finance.requestRefund')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {payment.sellers.map((s) => (
              <tr key={s.merchantOrderId ?? s.business.id}>
                <td>{s.business.name[locale]}</td>
                <td>{money(s.grossFils, locale)}</td>
                <td>{money(s.refundableFils, locale)}</td>
                {refund ? (
                  <td>
                    {s.refundableFils > 0 ? (
                      <form action={requestRefund} className="inline-form">
                        <input type="hidden" name="paymentId" value={payment.id} />
                        <input
                          type="hidden"
                          name="merchantOrderId"
                          value={s.merchantOrderId ?? ''}
                        />
                        <input type="hidden" name="back" value={back} />
                        <label className="sr-only" htmlFor={`amount-${s.business.id}`}>
                          {tr('admin.finance.amountAed')}
                        </label>
                        <input
                          id={`amount-${s.business.id}`}
                          name="amount"
                          inputMode="decimal"
                          required
                          className="ltr"
                          placeholder={tr('admin.finance.amountAed')}
                          style={{ width: 110 }}
                        />
                        <label className="sr-only" htmlFor={`reason-${s.business.id}`}>
                          {tr('admin.finance.reason')}
                        </label>
                        <input
                          id={`reason-${s.business.id}`}
                          name="reason"
                          type="text"
                          required
                          minLength={3}
                          maxLength={500}
                          placeholder={tr('admin.finance.reason')}
                        />
                        <button className="btn secondary" type="submit">
                          {tr('admin.finance.requestRefund')}
                        </button>
                      </form>
                    ) : (
                      <span className="muted">{tr('admin.finance.nothingRefundable')}</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {refund ? <p className="muted">{tr('admin.finance.refundHint')}</p> : null}
    </Shell>
  );
}
