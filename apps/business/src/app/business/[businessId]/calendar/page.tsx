import type { MerchantBooking } from '@jays/contracts';
import { DEFAULT_TIMEZONE, addDays, isLocalDate, localDateOf } from '@jays/domain';
import Link from 'next/link';
import { Workspace, loadBusiness, money } from '../../../../components/Workspace';
import { serverApi } from '../../../../lib/api';
import { translator } from '../../../../lib/i18n';
import { bookingAction, createManualBooking } from '../schedule-actions';

type Search = Promise<Record<string, string | undefined>>;
const UUID = /^[0-9a-f-]{36}$/i;

/** One day of appointments in branch time, by staff member, with the actions each allows. */
export default async function CalendarPage({
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
  const base = `/business/${businessId}/calendar`;
  const date =
    query['date'] && isLocalDate(query['date'])
      ? query['date']
      : localDateOf(new Date(), DEFAULT_TIMEZONE);
  const branchFilter = query['branch'] && UUID.test(query['branch']) ? query['branch'] : undefined;
  const path = `${base}?date=${date}${branchFilter ? `&branch=${branchFilter}` : ''}`;
  const frame = { locale, business, tab: 'calendar' as const, path, title: tr('calendar.title') };
  const caps = business.myCapabilities;
  if (!caps.includes('appointments.view_all') && !caps.includes('appointments.view_own')) {
    return (
      <Workspace {...frame}>
        <div className="alert info">{tr('business.team.noAccess')}</div>
      </Workspace>
    );
  }
  const canSchedule = caps.includes('bookings.schedule');
  const api = await serverApi();
  const [page, branches, services, staff] = await Promise.all([
    api.calendar(businessId, {
      from: date,
      to: date,
      ...(branchFilter ? { branchId: branchFilter } : {}),
      limit: 200,
    }),
    api.branches(businessId),
    api.services(businessId),
    api.staff(businessId),
  ]);
  const timeFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    timeStyle: 'short',
    timeZone: DEFAULT_TIMEZONE,
  });
  const dayFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'full',
    timeZone: 'UTC',
  });
  const byStaff = new Map<string, { name: string; items: MerchantBooking[] }>();
  for (const b of page.items) {
    const entry = byStaff.get(b.staff.id) ?? { name: b.staff.displayName, items: [] };
    entry.items.push(b);
    byStaff.set(b.staff.id, entry);
  }
  const activeBranches = branches.filter((b) => b.status === 'active');
  const activeServices = services.filter((s) => s.status === 'active');
  const hidden = (b: MerchantBooking) => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="bookingId" value={b.id} />
      <input type="hidden" name="version" value={b.version} />
      <input type="hidden" name="date" value={date} />
      {branchFilter ? <input type="hidden" name="branch" value={branchFilter} /> : null}
    </>
  );
  const act = (b: MerchantBooking, action: 'check_in' | 'complete' | 'no_show') => (
    <form action={bookingAction}>
      {hidden(b)}
      <input type="hidden" name="action" value={action} />
      <button className={action === 'no_show' ? 'btn secondary' : 'btn'} type="submit">
        {tr(`booking.action.${action}`)}
      </button>
    </form>
  );
  return (
    <Workspace
      {...frame}
      intro={tr('calendar.intro')}
      error={query['error']}
      notice={query['saved'] ? tr('common.saved') : undefined}
    >
      <form method="get" action={base} className="inline-form" style={{ marginBottom: 16 }}>
        <Link
          className="btn secondary"
          href={`${base}?date=${addDays(date, -1)}${branchFilter ? `&branch=${branchFilter}` : ''}`}
        >
          {tr('calendar.prev')}
        </Link>
        <label className="sr-only" htmlFor="date">
          {tr('calendar.date')}
        </label>
        <input id="date" name="date" type="date" dir="ltr" defaultValue={date} />
        <label className="sr-only" htmlFor="branch">
          {tr('calendar.branch')}
        </label>
        <select id="branch" name="branch" defaultValue={branchFilter ?? ''}>
          <option value="">{tr('calendar.allBranches')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name[locale]}
            </option>
          ))}
        </select>
        <button className="btn secondary" type="submit">
          {tr('calendar.show')}
        </button>
        <Link
          className="btn secondary"
          href={`${base}?date=${addDays(date, 1)}${branchFilter ? `&branch=${branchFilter}` : ''}`}
        >
          {tr('calendar.next')}
        </Link>
      </form>
      <h2>{dayFmt.format(new Date(`${date}T00:00:00Z`))}</h2>
      <div className="split">
        <div className="stack">
          {byStaff.size === 0 ? <p className="muted">{tr('calendar.empty')}</p> : null}
          {[...byStaff.entries()].map(([id, group]) => (
            <section key={id}>
              <h3>{group.name}</h3>
              <ul className="list">
                {group.items.map((b) => (
                  <li key={b.id} className="row">
                    <div className="grow">
                      <strong>
                        <bdi>{timeFmt.format(new Date(b.startAt))}</bdi>–
                        <bdi>{timeFmt.format(new Date(b.endAt))}</bdi>
                      </strong>{' '}
                      · {b.service.title[locale]}
                      <div className="muted" style={{ fontSize: 14 }}>
                        {b.customer.name ?? '—'}
                        {b.customer.phone ? (
                          <>
                            {' '}
                            · <span className="ltr-inline">{b.customer.phone}</span>
                          </>
                        ) : null}{' '}
                        · {tr(`booking.source.${b.source}`)} ·{' '}
                        {b.paymentMode === 'prepaid'
                          ? tr('booking.prepaid')
                          : tr('booking.payAtVenue')}{' '}
                        · {money(b.priceFils, locale)}
                        {b.refundFils
                          ? ` · ${tr('booking.refunded', { amount: money(b.refundFils, locale) })}`
                          : ''}
                      </div>
                      {b.note ? (
                        <div className="muted" style={{ fontSize: 14 }}>
                          {b.note}
                        </div>
                      ) : null}
                    </div>
                    <span className={`badge ${b.status}`}>{tr(`bookingStatus.${b.status}`)}</span>
                    {canSchedule && b.status === 'confirmed' ? (
                      <div className="inline-form">
                        {act(b, 'check_in')}
                        {act(b, 'no_show')}
                        <form action={bookingAction} className="inline-form">
                          {hidden(b)}
                          <input type="hidden" name="action" value="cancel" />
                          <label className="sr-only" htmlFor={`reason-${b.id}`}>
                            {tr('calendar.cancelReason')}
                          </label>
                          <input
                            id={`reason-${b.id}`}
                            name="reason"
                            type="text"
                            placeholder={tr('calendar.cancelReason')}
                            maxLength={500}
                            style={{ width: 180 }}
                          />
                          <button className="btn secondary" type="submit">
                            {tr('booking.action.cancel')}
                          </button>
                        </form>
                      </div>
                    ) : null}
                    {canSchedule && b.status === 'checked_in' ? act(b, 'complete') : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {canSchedule &&
        activeBranches.length > 0 &&
        activeServices.length > 0 &&
        staff.length > 0 ? (
          <details className="card" open={page.items.length === 0}>
            <summary>
              <strong>{tr('calendar.addManual')}</strong>
            </summary>
            <p className="muted">{tr('manual.payAtVenue')}</p>
            <form action={createManualBooking}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="date" value={date} />
              {branchFilter ? <input type="hidden" name="branch" value={branchFilter} /> : null}
              <div className="field">
                <label htmlFor="m-branch">{tr('calendar.branch')}</label>
                <select
                  id="m-branch"
                  name="branchId"
                  defaultValue={branchFilter ?? activeBranches[0]?.id}
                >
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name[locale]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-service">{tr('manual.service')}</label>
                <select id="m-service" name="serviceId">
                  {activeServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title[locale]} ({s.durationMin} min)
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-staff">{tr('manual.staff')}</label>
                <select id="m-staff" name="staffId">
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-time">{tr('manual.time')}</label>
                <input id="m-time" name="time" type="time" step={900} dir="ltr" required />
              </div>
              <div className="field">
                <label htmlFor="m-name">{tr('manual.customerName')}</label>
                <input id="m-name" name="customerName" type="text" maxLength={120} required />
              </div>
              <div className="field">
                <label htmlFor="m-phone">{tr('manual.customerPhone')}</label>
                <input id="m-phone" name="customerPhone" type="tel" dir="ltr" maxLength={16} />
              </div>
              <div className="field">
                <label htmlFor="m-note">{tr('manual.note')}</label>
                <input id="m-note" name="note" type="text" maxLength={500} />
              </div>
              <button className="btn" type="submit">
                {tr('manual.create')}
              </button>
            </form>
          </details>
        ) : null}
      </div>
    </Workspace>
  );
}
