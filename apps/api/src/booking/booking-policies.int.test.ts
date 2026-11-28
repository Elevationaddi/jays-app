import { bookingSchema, merchantBookingSchema } from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../aftercare/notifications.service.js';
import {
  approvedVenue,
  confirmedBooking,
  dubaiDay,
  getBooking,
  shiftBookingTo,
  type Venue,
} from '../testing/booking.js';
import { bearer, type Harness, signUp, startHarness, uniqueEmail } from '../testing/harness.js';
import { addAddress, homeVenue } from '../testing/home.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const customer = () => signUp(h, uniqueEmail('policy-booker'));
const biz = (v: Venue, path: string) => `/v1/businesses/${v.businessId}${path}`;
const hours = (n: number) => new Date(h.clock.now().getTime() + n * 3_600_000);

async function refundOf(bookingId: string) {
  return h.db
    .selectFrom('refunds as r')
    .innerJoin('payments as p', 'p.id', 'r.payment_id')
    .select(['r.amount_fils', 'r.non_commissionable_fils', 'r.reason', 'r.status'])
    .where('p.booking_id', '=', bookingId)
    .execute();
}

async function earningOf(bookingId: string) {
  return h.db
    .selectFrom('merchant_earnings')
    .select([
      'gross_fils',
      'commission_fils',
      'commission_refunded_fils',
      'refunded_fils',
      'non_commissionable_fils',
      'non_commissionable_refunded_fils',
    ])
    .where('booking_id', '=', bookingId)
    .executeTakeFirstOrThrow();
}

async function homeBooking(v: Venue, user: Awaited<ReturnType<typeof customer>>, at: string) {
  const marina = await addAddress(h, user, 'DXB', 'Dubai Marina');
  return confirmedBooking(h, user, {
    branchId: v.branchId,
    serviceId: v.serviceId,
    startAt: at,
    location: 'home',
    addressId: marina,
  } as never);
}

const travel = (v: Venue, id: string, status: string, expectedVersion: number) =>
  h
    .http()
    .post(biz(v, `/bookings/${id}/travel`))
    .set('Authorization', bearer(v.owner))
    .send({ status, expectedVersion });

describe('home-visit travel and the travel fee (ADR-0025)', () => {
  it('refunds the travel fee in full before travel starts, without commission', async () => {
    const { v } = await homeVenue(h);
    const user = await customer();
    const day = dubaiDay(h, 3);
    const booking = await homeBooking(v, user, day.at('10:00'));
    // 120.00: 105.00 service (100.00 + VAT) and a 15.00 travel fee.
    expect(booking).toMatchObject({ priceFils: 12_000, travelFeeFils: 1_500 });
    expect(booking.travelStatus).toBe('not_started');
    await shiftBookingTo(h, booking.id, hours(2));
    // Late: half the service back (the default 50% share) and the whole travel fee.
    expect((await getBooking(h, user, booking.id)).cancelRefundFils).toBe(5_250 + 1_500);
    const res = await h
      .http()
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', bearer(user))
      .send({})
      .expect(200);
    expect(bookingSchema.parse(res.body).refundFils).toBe(6_750);
    await h.deliverWebhooks();
    expect(await refundOf(booking.id)).toEqual([
      {
        amount_fils: 6_750,
        non_commissionable_fils: 1_500,
        reason: 'customer_cancellation',
        status: 'succeeded',
      },
    ]);
    // The travel fee returns no commission: half the service returns half the commission.
    const e = await earningOf(booking.id);
    expect(e).toMatchObject({
      gross_fils: 12_000,
      refunded_fils: 6_750,
      non_commissionable_fils: 1_500,
      non_commissionable_refunded_fils: 1_500,
    });
    expect(e.commission_refunded_fils).toBe(Math.round(e.commission_fils / 2));
  });

  it('records travel steps, tells the customer, and applies the policy once travel starts', async () => {
    const { v } = await homeVenue(h);
    const user = await customer();
    const booking = await homeBooking(v, user, dubaiDay(h, 3).at('10:00'));

    const early = await travel(v, booking.id, 'on_the_way', booking.version).expect(422);
    expect(early.body.error.code).toBe('TOO_EARLY');
    const skip = await travel(v, booking.id, 'arrived', booking.version).expect(409);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');
    const stale = await travel(v, booking.id, 'on_the_way', booking.version - 1).expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    await shiftBookingTo(h, booking.id, hours(2));
    const onWay = merchantBookingSchema.parse(
      (await travel(v, booking.id, 'on_the_way', booking.version).expect(200)).body,
    );
    expect(onWay.travelStatus).toBe('on_the_way');
    expect(onWay.travelEvents.map((t) => t.status)).toEqual(['on_the_way']);
    const back = await travel(v, booking.id, 'on_the_way', onWay.version).expect(409);
    expect(back.body.error.code).toBe('INVALID_TRANSITION');
    // The log cannot be edited.
    await expect(
      h.db.deleteFrom('booking_travel_events').where('booking_id', '=', booking.id).execute(),
    ).rejects.toThrow(/append-only/);

    const events = await h.db
      .selectFrom('outbox')
      .select(['id', 'payload'])
      .where('event_type', '=', 'booking.travel_started')
      .execute();
    const mine = events.filter(
      (e) => (e.payload as { bookingId: string }).bookingId === booking.id,
    );
    expect(mine).toHaveLength(1);
    await h.db
      .updateTable('outbox')
      .set({ available_at: h.clock.now() })
      .where('id', '=', mine[0]!.id)
      .execute();
    await h.app.get(NotificationsService).dispatch(10, [mine[0]!.id]);
    const note = await h.db
      .selectFrom('notifications')
      .select(['title', 'link'])
      .where('user_id', '=', user.user.id)
      .where('event_type', '=', 'booking.travel_started')
      .executeTakeFirstOrThrow();
    expect(note.title).toMatch(/is on the way/);
    expect(note.link).toBe(`/bookings/${booking.id}`);

    // Travel has started: the late share applies to the travel fee too.
    expect((await getBooking(h, user, booking.id)).cancelRefundFils).toBe(5_250 + 750);
    await h
      .http()
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', bearer(user))
      .send({})
      .expect(200);
    await h.deliverWebhooks();
    expect(await refundOf(booking.id)).toEqual([
      expect.objectContaining({ amount_fils: 6_000, non_commissionable_fils: 750 }),
    ]);
  });

  it('refuses travel status on venue bookings and to other professionals', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    expect(booking.travelStatus).toBeNull();
    const res = await travel(v, booking.id, 'on_the_way', booking.version).expect(409);
    expect(res.body.error.code).toBe('NOT_A_HOME_VISIT');
    const other = await approvedVenue(h);
    await h
      .http()
      .post(biz(other, `/bookings/${booking.id}/travel`))
      .set('Authorization', bearer(other.owner))
      .send({ status: 'on_the_way', expectedVersion: booking.version })
      .expect(404);
  });
});

describe('no-show refunds and per-component amounts (D7, ADR-0027)', () => {
  it('refunds the no-show share in the snapshot, and shows each part of the price', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const day = dubaiDay(h, 3);
    // Booked before the policy changes: its snapshot promises nothing for a no-show.
    const before = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
    });
    expect(before.policy.noShowRefundBps).toBe(0);
    await h
      .http()
      .patch(biz(v, `/services/${v.serviceId}`))
      .set('Authorization', bearer(v.owner))
      .send({ noShowRefundBps: 2_500 })
      .expect(200);
    const after = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('14:00'),
    });
    expect(after.policy.noShowRefundBps).toBe(2_500);

    for (const b of [before, after]) {
      await shiftBookingTo(h, b.id, hours(-0.5));
      await h
        .http()
        .post(biz(v, `/bookings/${b.id}/actions`))
        .set('Authorization', bearer(v.owner))
        .send({ action: 'no_show', expectedVersion: b.version })
        .expect(200);
    }
    await h.deliverWebhooks();
    expect(await refundOf(before.id)).toEqual([]);
    expect(await refundOf(after.id)).toEqual([
      { amount_fils: 2_625, non_commissionable_fils: 0, reason: 'no_show', status: 'succeeded' },
    ]);

    const view = merchantBookingSchema.parse(
      (
        await h
          .http()
          .get(biz(v, `/bookings/${after.id}`))
          .set('Authorization', bearer(v.owner))
          .expect(200)
      ).body,
    );
    const e = await earningOf(after.id);
    expect(view.amounts).toMatchObject({
      serviceFils: 10_500,
      addonsFils: 0,
      travelFeeFils: 0,
      vatFils: 500,
      refundedFils: 2_625,
      processingFeeFils: null,
      commissionFils: e.commission_fils - e.commission_refunded_fils,
    });
    expect(view.amounts!.merchantNetFils).toBe(
      10_500 - 2_625 - (e.commission_fils - e.commission_refunded_fils),
    );
  });
});
