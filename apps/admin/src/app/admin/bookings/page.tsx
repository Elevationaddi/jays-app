import type { MessageKey } from '@jays/i18n';
import { BOOKING_STATUSES, type BookingStatus, fils, formatAed } from '@jays/domain';
import Link from 'next/link';
import { ErrorAlert } from '../../../components/ErrorAlert';
import { Shell } from '../../../components/Shell';
import { requireAdmin } from '../../../lib/admin';
import { translator } from '../../../lib/i18n';

type Search = Promise<Record<string, string | undefined>>;

/** Read-only monitoring of bookings across businesses (operations, support). */
export default async function BookingsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { locale, tr } = await translator();
  const { api, admin } = await requireAdmin('/admin/bookings');
  if (!admin.capabilities.includes('bookings.view')) {
    return (
      <Shell locale={locale} admin={admin} current="bookings">
        <div className="alert error">{tr('admin.forbidden')}</div>
      </Shell>
    );
  }
  const status = (BOOKING_STATUSES as readonly string[]).includes(params['status'] ?? '')
    ? (params['status'] as BookingStatus)
    : undefined;
  const page = await api.adminBookings({
    ...(status ? { status } : {}),
    limit: 50,
    ...(params['cursor'] ? { cursor: params['cursor'] } : {}),
  });
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  });
  return (
    <Shell locale={locale} admin={admin} current="bookings">
      <h1>{tr('admin.bookings.title')}</h1>
      <p className="muted">{tr('admin.bookings.intro')}</p>
      <ErrorAlert locale={locale} code={params['error']} />
      <nav className="tabs filters" aria-label={tr('admin.bookings.status')}>
        <Link href="/admin/bookings" aria-current={status ? undefined : 'page'}>
          {tr('admin.bookings.all')}
        </Link>
        {BOOKING_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/bookings?status=${s}`}
            aria-current={status === s ? 'page' : undefined}
          >
            {tr(`bookingStatus.${s}`)}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">{tr('admin.bookings.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('calendar.date')}</th>
                <th>{tr('admin.product.store')}</th>
                <th>{tr('manual.service')}</th>
                <th>{tr('manual.staff')}</th>
                <th>{tr('admin.bookings.status')}</th>
                <th>{tr('service.price')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((b) => (
                <tr key={b.id}>
                  <td>{when.format(new Date(b.startAt))}</td>
                  <td>
                    {b.business.name[locale]}
                    <div className="muted">{b.branch.name[locale]}</div>
                  </td>
                  <td>{b.service.title[locale]}</td>
                  <td>{b.staff.displayName}</td>
                  <td>
                    <span className={`badge ${b.status}`}>{tr(`bookingStatus.${b.status}`)}</span>
                    <div className="muted">
                      {tr(`booking.source.${b.source}`)}
                      {b.paymentStatus
                        ? ` · ${tr(`payment.status.${b.paymentStatus}` as MessageKey)}`
                        : ''}
                    </div>
                    {b.paymentNeedsAttention ? (
                      <div className="badge rejected">{tr('admin.bookings.attention')}</div>
                    ) : null}
                  </td>
                  <td>
                    {formatAed(fils(b.priceFils), locale)}
                    {b.refundFils ? (
                      <div className="muted">
                        {tr('booking.refunded', { amount: formatAed(fils(b.refundFils), locale) })}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p>
          <Link
            href={`/admin/bookings?${status ? `status=${status}&` : ''}cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            {tr('common.next')} →
          </Link>
        </p>
      ) : null}
    </Shell>
  );
}
