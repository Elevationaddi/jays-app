import { randomUUID } from 'node:crypto';
import {
  bookingSchema,
  branchSchema,
  payBookingResponseSchema,
  serviceSchema,
  type Session,
  staffSchema,
} from '@jays/contracts';
import { addDays, localDateOf, localToUtc } from '@jays/domain';
import { sql } from 'kysely';
import { bearer, createBusiness, type Harness, signUp, uniqueEmail } from './harness.js';

/** Fixtures for phase 4 integration tests. All data is fictional. */

export const TZ = 'Asia/Dubai';
const ALL_WEEK = (start: string, end: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start, end }));

let seq = 0;

/** A local date `days` from today in Dubai, and the UTC instant of a local time on it. */
export function dubaiDay(h: Harness, days: number) {
  const date = addDays(localDateOf(h.clock.now(), TZ), days);
  return {
    date,
    at: (hhmm: string) => {
      const [hh, mm] = hhmm.split(':').map(Number);
      return localToUtc(date, (hh as number) * 60 + (mm as number), TZ).toISOString();
    },
  };
}

export async function servicesCategoryId(h: Harness, slug = 'hair') {
  const row = await h.db
    .selectFrom('categories')
    .select('id')
    .where('mode', '=', 'services')
    .where('slug', '=', slug)
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface Venue {
  owner: Session;
  businessId: string;
  branchId: string;
  serviceId: string;
  staffIds: string[];
}

/**
 * An approved services business with a published storefront, one branch open 09:00-18:00 every
 * day, one service and `staff` professionals working 09:00-18:00 every day. The approval itself
 * is written directly (phase 2 tests cover onboarding); everything else goes through the API.
 */
export async function approvedVenue(
  h: Harness,
  opts: {
    staff?: number;
    service?: Partial<{
      priceFils: number;
      durationMin: number;
      bufferBeforeMin: number;
      bufferAfterMin: number;
      cancelCutoffHours: number;
      lateCancelRefundBps: number;
    }>;
  } = {},
): Promise<Venue> {
  seq += 1;
  const owner = await signUp(h, uniqueEmail('venue-owner'));
  const business = await createBusiness(h, owner, ['services'], {
    en: `Fictional Salon ${seq}`,
    ar: 'صالون تجريبي',
  });
  const now = new Date();
  await h.db
    .updateTable('businesses')
    .set({
      status: 'approved',
      legal_name: 'Fictional Beauty LLC',
      // Fictional TRN: test sellers are VAT registered, so they charge VAT (D4).
      tax_registered: true,
      tax_id: '100000000000003',
      trade_license_number: `TL-S-${Date.now() % 1e8}-${seq}`,
      license_authority: 'Fictional Authority',
      license_expiry: '2030-01-01',
      address_emirate_code: 'DXB',
      address_area: 'Area',
      address_street: 'Street',
      address_building: 'Building',
      agreement_version: 'merchant-draft-2026-11',
      agreement_accepted_at: now,
      agreement_accepted_by: owner.user.id,
      submitted_at: now,
      reviewed_at: now,
    })
    .where('id', '=', business.id)
    .execute();
  await h.db
    .updateTable('business_modes')
    .set({ status: 'active', submitted_at: now, reviewed_at: now })
    .where('business_id', '=', business.id)
    .execute();
  const name = JSON.stringify({ en: `Fictional Salon ${seq}`, ar: 'صالون تجريبي' });
  const description = JSON.stringify({ en: 'A fictional salon.', ar: 'صالون تجريبي.' });
  await h.db
    .insertInto('storefronts')
    .values({
      business_id: business.id,
      name,
      description,
      live_name: name,
      live_description: description,
      published_at: now,
    })
    .onConflict((oc) =>
      oc
        .column('business_id')
        .doUpdateSet({ live_name: name, live_description: description, published_at: now }),
    )
    .execute();

  const auth = bearer(owner);
  const base = `/v1/businesses/${business.id}`;
  const branch = branchSchema.parse(
    (
      await h
        .http()
        .post(`${base}/branches`)
        .set('Authorization', auth)
        .send({
          name: { en: 'Marina branch', ar: 'فرع المارينا' },
          emirate: 'DXB',
          area: 'Dubai Marina',
          street: 'Fictional Walk',
          building: 'Tower 7',
          hours: ALL_WEEK('09:00', '18:00'),
        })
        .expect(201)
    ).body,
  );
  const service = serviceSchema.parse(
    (
      await h
        .http()
        .post(`${base}/services`)
        .set('Authorization', auth)
        .send({
          categoryId: await servicesCategoryId(h),
          title: { en: 'Fictional haircut', ar: 'قصة شعر تجريبية' },
          description: { en: 'A fictional haircut for tests.', ar: 'قصة شعر تجريبية للاختبار.' },
          priceFils: 10_500,
          durationMin: 60,
          bufferBeforeMin: 0,
          bufferAfterMin: 15,
          cancelCutoffHours: 24,
          lateCancelRefundBps: 5_000,
          branchIds: [branch.id],
          ...opts.service,
        })
        .expect(201)
    ).body,
  );
  const staffIds: string[] = [];
  for (let i = 0; i < (opts.staff ?? 1); i += 1) {
    const staff = staffSchema.parse(
      (
        await h
          .http()
          .post(`${base}/staff`)
          .set('Authorization', auth)
          .send({
            displayName: `Stylist ${String.fromCharCode(65 + i)}`,
            branchIds: [branch.id],
            serviceIds: [service.id],
          })
          .expect(201)
      ).body,
    );
    await h
      .http()
      .put(`${base}/staff/${staff.id}/shifts`)
      .set('Authorization', auth)
      .send({
        shifts: ALL_WEEK('09:00', '18:00').map((s) => ({ ...s, branchId: branch.id })),
      })
      .expect(200);
    staffIds.push(staff.id);
  }
  return { owner, businessId: business.id, branchId: branch.id, serviceId: service.id, staffIds };
}

export function holdRequest(
  h: Harness,
  session: Session,
  body: {
    branchId: string;
    serviceId: string;
    startAt: string;
    staffId?: string | null;
    addonIds?: string[];
  },
  key = `hold-${randomUUID()}`,
) {
  return h
    .http()
    .post('/v1/bookings/hold')
    .set('Authorization', bearer(session))
    .set('Idempotency-Key', key)
    .send(body);
}

export async function held(
  h: Harness,
  session: Session,
  body: {
    branchId: string;
    serviceId: string;
    startAt: string;
    staffId?: string | null;
    addonIds?: string[];
  },
) {
  const res = await holdRequest(h, session, body);
  if (res.status !== 201) throw new Error(`hold failed: ${res.status} ${JSON.stringify(res.body)}`);
  return bookingSchema.parse(res.body);
}

export async function payBooking(
  h: Harness,
  session: Session,
  bookingId: string,
  outcome: 'success' | 'fail' | 'timeout' | 'duplicate' = 'success',
) {
  const pay = payBookingResponseSchema.parse(
    (
      await h
        .http()
        .post(`/v1/bookings/${bookingId}/pay`)
        .set('Authorization', bearer(session))
        .expect(200)
    ).body,
  );
  await h
    .http()
    .post(`/v1/mock-psp/intents/${pay.paymentIntentId}/confirm`)
    .send({ clientSecret: pay.paymentClientSecret, outcome })
    .expect(200);
  await h.deliverWebhooks();
  return pay;
}

export async function confirmedBooking(
  h: Harness,
  session: Session,
  body: {
    branchId: string;
    serviceId: string;
    startAt: string;
    staffId?: string | null;
    addonIds?: string[];
  },
) {
  const booking = await held(h, session, body);
  await payBooking(h, session, booking.id);
  return getBooking(h, session, booking.id);
}

export async function getBooking(h: Harness, session: Session, id: string) {
  return bookingSchema.parse(
    (await h.http().get(`/v1/bookings/${id}`).set('Authorization', bearer(session)).expect(200))
      .body,
  );
}

/** Ends a hold now (moving the clock would also expire access tokens). */
export async function endHold(h: Harness, bookingId: string) {
  await h.db
    .updateTable('bookings')
    .set({ hold_expires_at: new Date(h.clock.now().getTime() - 1000) })
    .where('id', '=', bookingId)
    .execute();
}

export async function runHoldExpiry(h: Harness) {
  const { rows } = await sql<{
    n: number;
  }>`SELECT expire_booking_holds(${h.clock.now()}, 500) AS n`.execute(h.db);
  return Number(rows[0]?.n ?? 0);
}

/** Moves a booking's start (and occupied interval) so time-based rules can be tested. */
export async function shiftBookingTo(h: Harness, bookingId: string, startAt: Date) {
  const b = await h.db
    .selectFrom('bookings')
    .select(['start_at', 'end_at', 'occupied_start', 'occupied_end'])
    .where('id', '=', bookingId)
    .executeTakeFirstOrThrow();
  const delta = startAt.getTime() - b.start_at.getTime();
  const move = (d: Date) => new Date(d.getTime() + delta);
  await h.db
    .updateTable('bookings')
    .set({
      start_at: move(b.start_at),
      end_at: move(b.end_at),
      occupied_start: move(b.occupied_start),
      occupied_end: move(b.occupied_end),
    })
    .where('id', '=', bookingId)
    .execute();
}
