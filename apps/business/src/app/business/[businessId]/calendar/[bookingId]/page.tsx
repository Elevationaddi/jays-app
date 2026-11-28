import type { MessageKey } from '@jays/i18n';
import { DEFAULT_TIMEZONE, localDateOf } from '@jays/domain';
import Link from 'next/link';
import { Workspace, loadBusiness, money } from '../../../../../components/Workspace';
import { serverApi } from '../../../../../lib/api';
import { translator } from '../../../../../lib/i18n';
import { updateTravel } from '../../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;

/**
 * One appointment (phase 8.8): each part of the price, commission and what the business keeps,
 * the policy the customer accepted, and a home visit's travel steps.
 */
export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; bookingId: string }>;
  searchParams: Search;
}) {
  const { businessId, bookingId } = await params;
  const query = await searchParams;
  const { locale, tr } = await translator();
  const business = await loadBusiness(businessId);
  const path = `/business/${businessId}/calendar/${bookingId}`;
  const b = await (await serverApi()).merchantBooking(businessId, bookingId);
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: DEFAULT_TIMEZONE,
  });
  const a = b.amounts;
  const rows: Array<[MessageKey, number | null]> = a
    ? [
        ['amounts.service', a.serviceFils],
        ...(a.addonsFils > 0
          ? ([['amounts.addons', a.addonsFils]] as Array<[MessageKey, number]>)
          : []),
        ...(a.travelFeeFils > 0
          ? ([['amounts.travel', a.travelFeeFils]] as Array<[MessageKey, number]>)
          : []),
        ['amounts.vatIncluded', a.vatFils],
        ['amounts.refunded', a.refundedFils],
        ['amounts.commission', a.commissionFils],
        ['amounts.commissionVat', a.commissionVatFils],
        ['amounts.processingFee', a.processingFeeFils],
        ['amounts.net', a.merchantNetFils],
      ]
    : [];
  const next =
    b.location !== 'home'
      ? null
      : b.travelStatus === 'not_started' && b.status === 'confirmed'
        ? 'on_the_way'
        : b.travelStatus === 'on_the_way' && ['confirmed', 'checked_in'].includes(b.status)
          ? 'arrived'
          : null;
  const day = localDateOf(new Date(b.startAt), DEFAULT_TIMEZONE);
  return (
    <Workspace
      locale={locale}
      business={business}
      tab="calendar"
      path={path}
      title={`${b.service.title[locale]} · ${fmt.format(new Date(b.startAt))}`}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <p>
        <Link href={`/business/${businessId}/calendar?date=${day}`}>{tr('calendar.title')}</Link>
      </p>
      <div className="grid2">
        <section className="card">
          <h2>{tr('amounts.title')}</h2>
          <p>
            <span className={`badge ${b.status}`}>{tr(`bookingStatus.${b.status}`)}</span>{' '}
            {b.staff.displayName} · {b.customer.name ?? '—'}
          </p>
          <table>
            <tbody>
              <tr>
                <th scope="row">{tr('amounts.total')}</th>
                <td>{money(b.priceFils, locale)}</td>
              </tr>
              {rows.map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{tr(key)}</th>
                  <td>
                    {value === null
                      ? key === 'amounts.processingFee'
                        ? tr('amounts.processingPending')
                        : tr('amounts.notCaptured')
                      : money(value, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.addons.length > 0 ? (
            <ul className="muted" style={{ fontSize: 14 }}>
              {b.addons.map((x) => (
                <li key={x.id}>
                  {x.title[locale]} · {money(x.priceFils, locale)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="card">
          <h2>{tr('policy.title')}</h2>
          <ul>
            <li>{tr('policy.cutoff', { hours: b.policy.cutoffHours })}</li>
            <li>{tr('policy.late', { percent: b.policy.lateRefundBps / 100 })}</li>
            <li>{tr('policy.noShow', { percent: b.policy.noShowRefundBps / 100 })}</li>
            {b.location === 'home' ? <li>{tr('policy.travelFee')}</li> : null}
          </ul>
          {b.location === 'home' ? (
            <>
              <h2>{tr('travel.title')}</h2>
              <p>
                <span className="badge">
                  {tr(`travel.status.${b.travelStatus ?? 'not_started'}`)}
                </span>
              </p>
              {b.travelEvents.length > 0 ? (
                <ol>
                  {b.travelEvents.map((t) => (
                    <li key={t.status}>
                      {tr(`travel.status.${t.status}`)} · <bdi>{fmt.format(new Date(t.at))}</bdi>
                    </li>
                  ))}
                </ol>
              ) : null}
              {next ? (
                <form action={updateTravel}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="bookingId" value={b.id} />
                  <input type="hidden" name="version" value={b.version} />
                  <input type="hidden" name="back" value="detail" />
                  <input type="hidden" name="status" value={next} />
                  <button className="btn" type="submit">
                    {tr(`travel.mark.${next}`)}
                  </button>
                  <p className="muted" style={{ fontSize: 14 }}>
                    {tr('travel.hint')}
                  </p>
                </form>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </Workspace>
  );
}
