import {
  adminServiceSchema,
  availabilitySchema,
  bookingSchema,
  merchantBookingSchema,
  pageSchema,
  publicVenueSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approvedVenue,
  confirmedBooking,
  dubaiDay,
  endHold,
  getBooking,
  held,
  holdRequest,
  payBooking,
  runHoldExpiry,
  shiftBookingTo,
  TZ,
  type Venue,
} from '../testing/booking.js';
import {
  adminLogin,
  bearer,
  type Harness,
  provisionAdmin,
  signUp,
  startHarness,
  uniqueEmail,
} from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const customer = () => signUp(h, uniqueEmail('booker'));

async function slots(v: Venue, date: string, staffId?: string) {
  const res = await h
    .http()
    .get('/v1/availability')
    .query({ branchId: v.branchId, serviceId: v.serviceId, date, ...(staffId ? { staffId } : {}) })
    .expect(200);
  return availabilitySchema.parse(res.body);
}

const starts = async (v: Venue, date: string, staffId?: string) =>
  (await slots(v, date, staffId)).slots.map((s) => s.startAt);

async function paymentOf(bookingId: string) {
  return h.db
    .selectFrom('payments')
    .select(['id', 'status', 'amount_fils'])
    .where('booking_id', '=', bookingId)
    .executeTakeFirstOrThrow();
}

async function refundsOf(paymentId: string) {
  return h.db
    .selectFrom('refunds')
    .select(['amount_fils', 'reason', 'status'])
    .where('payment_id', '=', paymentId)
    .execute();
}

const biz = (v: Venue, path = '') => `/v1/businesses/${v.businessId}${path}`;

describe('venue and availability', () => {
  it('lists branches, services and staff, and slots in branch time', async () => {
    const v = await approvedVenue(h, { staff: 2 });
    const venue = publicVenueSchema.parse(
      (await h.http().get(`/v1/venues/${v.businessId}`).expect(200)).body,
    );
    expect(venue.branches).toHaveLength(1);
    expect(venue.services.map((s) => s.id)).toEqual([v.serviceId]);
    expect(venue.staff).toHaveLength(2);

    const day = dubaiDay(h, 2);
    const result = await slots(v, day.date);
    expect(result.timeZone).toBe(TZ);
    // 60 minutes plus a 15-minute buffer after, inside a 09:00-18:00 shift.
    expect(result.slots[0]?.startAt).toBe(day.at('09:00'));
    expect(result.slots.at(-1)?.startAt).toBe(day.at('16:45'));
    expect(result.slots[0]?.staffIds.sort()).toEqual([...v.staffIds].sort());
  });

  it('hides businesses that are not public and dates outside the window', async () => {
    const v = await approvedVenue(h);
    await h
      .http()
      .get('/v1/availability')
      .query({ branchId: v.branchId, serviceId: v.serviceId, date: dubaiDay(h, 61).date })
      .expect(422);
    await h.db
      .updateTable('business_modes')
      .set({ status: 'suspended' })
      .where('business_id', '=', v.businessId)
      .execute();
    await h.http().get(`/v1/venues/${v.businessId}`).expect(404);
    await h
      .http()
      .get('/v1/availability')
      .query({ branchId: v.branchId, serviceId: v.serviceId, date: dubaiDay(h, 2).date })
      .expect(404);
  });
});

describe('T07: no double booking', () => {
  it('lets exactly one of two simultaneous holds take the same professional and time', async () => {
    const v = await approvedVenue(h);
    const [a, b] = await Promise.all([customer(), customer()]);
    const body = {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 2).at('10:00'),
      staffId: v.staffIds[0],
    };
    const results = await Promise.all([holdRequest(h, a, body), holdRequest(h, b, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('allocates a burst of "any professional" holds to different people, never more than exist', async () => {
    const v = await approvedVenue(h, { staff: 2 });
    const people = await Promise.all(Array.from({ length: 6 }, () => customer()));
    const startAt = dubaiDay(h, 2).at('11:00');
    const results = await Promise.all(
      people.map((p) =>
        holdRequest(h, p, { branchId: v.branchId, serviceId: v.serviceId, startAt }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).map((r) => bookingSchema.parse(r.body));
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((b) => b.staff.id)).size).toBe(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    // Overlapping starts (buffer included) are gone for both; the next free start is 12:15.
    const left = await starts(v, dubaiDay(h, 2).date);
    expect(left).not.toContain(dubaiDay(h, 2).at('11:45'));
    expect(left).not.toContain(dubaiDay(h, 2).at('10:15'));
    expect(left).not.toContain(dubaiDay(h, 2).at('10:00')); // its buffer would reach 11:15
    expect(left).toContain(dubaiDay(h, 2).at('12:15'));
    expect(left).toContain(dubaiDay(h, 2).at('09:45'));
  });

  it('is enforced by the database even if application checks are bypassed', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await held(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    const row = await h.db
      .selectFrom('bookings')
      .selectAll()
      .where('id', '=', booking.id)
      .executeTakeFirstOrThrow();
    const { id: _id, created_at: _c, updated_at: _u, ...copy } = row;
    await expect(
      h.db
        .insertInto('bookings')
        .values({
          ...copy,
          snapshot: JSON.stringify(copy.snapshot),
          policy_snapshot: JSON.stringify(copy.policy_snapshot),
          addons: JSON.stringify(copy.addons),
          home_address: null,
          start_at: new Date(row.start_at.getTime() + 30 * 60_000),
          end_at: new Date(row.end_at.getTime() + 30 * 60_000),
          occupied_start: new Date(row.occupied_start.getTime() + 30 * 60_000),
          occupied_end: new Date(row.occupied_end.getTime() + 30 * 60_000),
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23P01' });
  });
});

describe('T08: holds, payment and expiry', () => {
  it('confirms a held booking only through the verified payment webhook', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const day = dubaiDay(h, 2);
    const booking = await held(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
    });
    expect(booking.status).toBe('held');
    expect(booking.holdExpiresAt).not.toBeNull();
    expect(booking.priceFils).toBe(10_500);
    expect(booking.taxFils).toBe(500);
    expect(await starts(v, day.date)).not.toContain(day.at('10:00'));

    const pay = await h
      .http()
      .post(`/v1/bookings/${booking.id}/pay`)
      .set('Authorization', bearer(user))
      .expect(200);
    const again = await h
      .http()
      .post(`/v1/bookings/${booking.id}/pay`)
      .set('Authorization', bearer(user))
      .expect(200);
    expect(again.body.paymentIntentId).toBe(pay.body.paymentIntentId);
    expect((await getBooking(h, user, booking.id)).status).toBe('held');

    await h
      .http()
      .post(`/v1/mock-psp/intents/${pay.body.paymentIntentId}/confirm`)
      .send({ clientSecret: pay.body.paymentClientSecret, outcome: 'success' })
      .expect(200);
    await h.deliverWebhooks();
    const confirmed = await getBooking(h, user, booking.id);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.holdExpiresAt).toBeNull();
    expect((await paymentOf(booking.id)).status).toBe('succeeded');
  });

  it('returns the same hold for a retried request with the same key', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const body = {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 2).at('13:00'),
    };
    const first = await holdRequest(h, user, body, 'hold-retry-key-1').expect(201);
    const second = await holdRequest(h, user, body, 'hold-retry-key-1').expect(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('frees the time when a hold expires, and refuses to pay for it', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const day = dubaiDay(h, 2);
    const booking = await held(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
    });
    await endHold(h, booking.id);
    expect(await runHoldExpiry(h)).toBeGreaterThanOrEqual(1);
    expect((await getBooking(h, user, booking.id)).status).toBe('expired');
    expect(await starts(v, day.date)).toContain(day.at('10:00'));
    const res = await h
      .http()
      .post(`/v1/bookings/${booking.id}/pay`)
      .set('Authorization', bearer(user))
      .expect(409);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });

  it('refunds a payment that succeeds after the hold ended', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await held(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 2).at('10:00'),
    });
    const pay = await h
      .http()
      .post(`/v1/bookings/${booking.id}/pay`)
      .set('Authorization', bearer(user))
      .expect(200);
    await endHold(h, booking.id);
    await h
      .http()
      .post(`/v1/mock-psp/intents/${pay.body.paymentIntentId}/confirm`)
      .send({ clientSecret: pay.body.paymentClientSecret, outcome: 'success' })
      .expect(200);
    await h.deliverWebhooks(); // payment succeeded -> refund requested
    await h.deliverWebhooks(); // refund succeeded
    expect((await getBooking(h, user, booking.id)).status).toBe('expired');
    const payment = await paymentOf(booking.id);
    expect(payment.status).toBe('refunded');
    expect(await refundsOf(payment.id)).toEqual([
      { amount_fils: 10_500, reason: 'late_payment', status: 'succeeded' },
    ]);
  });

  it('releases the time when the payment fails', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const day = dubaiDay(h, 2);
    const booking = await held(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('15:00'),
    });
    await payBooking(h, user, booking.id, 'fail');
    expect((await getBooking(h, user, booking.id)).status).toBe('expired');
    expect((await paymentOf(booking.id)).status).toBe('failed');
    expect(await starts(v, day.date)).toContain(day.at('15:00'));
  });

  it('caps open holds per customer', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const day = dubaiDay(h, 2);
    for (const t of ['09:00', '11:00']) {
      await held(h, user, { branchId: v.branchId, serviceId: v.serviceId, startAt: day.at(t) });
    }
    const res = await holdRequest(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('14:00'),
    }).expect(409);
    expect(res.body.error.code).toBe('HOLD_LIMIT');
  });

  it('gives "any professional" to the one with fewer appointments that day', async () => {
    const v = await approvedVenue(h, { staff: 2 });
    const day = dubaiDay(h, 2);
    const sorted = [...v.staffIds].sort();
    // The lower id is the tie-breaker, so load it first and expect the other next.
    await confirmedBooking(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('09:00'),
      staffId: sorted[0],
    });
    const next = await held(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('14:00'),
    });
    expect(next.staff.id).toBe(sorted[1]);
  });

  it('refuses unaligned and past start times', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const off = new Date(Date.parse(dubaiDay(h, 2).at('10:00')) + 7 * 60_000).toISOString();
    expect(
      (await holdRequest(h, user, { branchId: v.branchId, serviceId: v.serviceId, startAt: off }))
        .status,
    ).toBe(409);
    const past = dubaiDay(h, 0).at('00:00');
    expect(
      (await holdRequest(h, user, { branchId: v.branchId, serviceId: v.serviceId, startAt: past }))
        .status,
    ).toBe(409);
  });
});

describe('T09: cancellation and refunds', () => {
  it('refunds in full before the cutoff', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    expect(booking.cancelRefundFils).toBe(10_500);
    const res = await h
      .http()
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', bearer(user))
      .send({ reason: 'Plans changed' })
      .expect(200);
    const canceled = bookingSchema.parse(res.body);
    expect(canceled.status).toBe('canceled');
    expect(canceled.refundFils).toBe(10_500);
    expect(canceled.canceledBy).toBe('customer');
    await h.deliverWebhooks();
    const payment = await paymentOf(booking.id);
    expect(payment.status).toBe('refunded');
    expect(await refundsOf(payment.id)).toEqual([
      { amount_fils: 10_500, reason: 'customer_cancellation', status: 'succeeded' },
    ]);
  });

  it('refunds the late share after the cutoff and nothing once started', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const late = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    await shiftBookingTo(h, late.id, new Date(h.clock.now().getTime() + 2 * 3_600_000));
    expect((await getBooking(h, user, late.id)).cancelRefundFils).toBe(5_250);
    const res = await h
      .http()
      .post(`/v1/bookings/${late.id}/cancel`)
      .set('Authorization', bearer(user))
      .send({})
      .expect(200);
    expect(res.body.refundFils).toBe(5_250);
    await h.deliverWebhooks();
    expect((await paymentOf(late.id)).status).toBe('partially_refunded');

    const started = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('14:00'),
    });
    await shiftBookingTo(h, started.id, new Date(h.clock.now().getTime() - 60_000));
    const tooLate = await h
      .http()
      .post(`/v1/bookings/${started.id}/cancel`)
      .set('Authorization', bearer(user))
      .send({})
      .expect(422);
    expect(tooLate.body.error.code).toBe('CANCEL_TOO_LATE');
  });

  it('refunds in full when the business cancels, even late', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    await shiftBookingTo(h, booking.id, new Date(h.clock.now().getTime() + 3_600_000));
    const res = await h
      .http()
      .post(biz(v, `/bookings/${booking.id}/actions`))
      .set('Authorization', bearer(v.owner))
      .send({ action: 'cancel', expectedVersion: booking.version, reason: 'Stylist unwell' })
      .expect(200);
    const view = merchantBookingSchema.parse(res.body);
    expect(view.status).toBe('canceled');
    expect(view.refundFils).toBe(10_500);
    expect(view.canceledBy).toBe('business');
    await h.deliverWebhooks();
    expect((await paymentOf(booking.id)).status).toBe('refunded');
  });
});

describe('T13: service edits do not change existing bookings', () => {
  it('keeps the booked price, duration and policy', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    await h
      .http()
      .patch(biz(v, `/services/${v.serviceId}`))
      .set('Authorization', bearer(v.owner))
      .send({
        priceFils: 20_000,
        durationMin: 90,
        title: { en: 'Renamed haircut', ar: 'قصة شعر جديدة' },
        lateCancelRefundBps: 0,
      })
      .expect(200);
    const after = await getBooking(h, user, booking.id);
    expect(after.priceFils).toBe(10_500);
    expect(after.endAt).toBe(booking.endAt);
    expect(after.service.title.en).toBe('Fictional haircut');
    expect(after.policy).toEqual({ cutoffHours: 24, lateRefundBps: 5_000 });
  });
});

describe('T14: dates and times in the branch timezone', () => {
  it('books just after local midnight, which is the previous UTC day', async () => {
    const v = await approvedVenue(h);
    const auth = bearer(v.owner);
    const all = (start: string, end: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start, end }));
    await h
      .http()
      .patch(biz(v, `/branches/${v.branchId}`))
      .set('Authorization', auth)
      .send({ hours: all('00:00', '23:55') })
      .expect(200);
    await h
      .http()
      .put(biz(v, `/staff/${v.staffIds[0]}/shifts`))
      .set('Authorization', auth)
      .send({ shifts: all('00:00', '03:00').map((s) => ({ ...s, branchId: v.branchId })) })
      .expect(200);
    const day = dubaiDay(h, 3);
    const list = await starts(v, day.date);
    expect(list[0]).toBe(day.at('00:00'));
    expect(list[0]?.slice(0, 10)).not.toBe(day.date); // 20:00Z the day before
    expect(await starts(v, dubaiDay(h, 2).date)).not.toContain(day.at('00:00'));
    const booking = await held(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('00:00'),
    });
    expect(booking.startAt).toBe(new Date(day.at('00:00')).toISOString());
    expect(booking.timeZone).toBe(TZ);
  });
});

describe('schedule changes protect upcoming bookings', () => {
  it('refuses shifts, blocks, closures, hours and archiving that would strand a booking', async () => {
    const v = await approvedVenue(h);
    const auth = bearer(v.owner);
    const day = dubaiDay(h, 3);
    const booking = await confirmedBooking(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
    });
    const later = (t: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: t, end: '18:00' }));

    const shifts = await h
      .http()
      .put(biz(v, `/staff/${v.staffIds[0]}/shifts`))
      .set('Authorization', auth)
      .send({ shifts: later('12:00').map((s) => ({ ...s, branchId: v.branchId })) })
      .expect(409);
    expect(shifts.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(shifts.body.error.fieldErrors.bookings).toEqual([booking.id]);

    await h
      .http()
      .post(biz(v, '/blocks'))
      .set('Authorization', auth)
      .send({
        staffId: v.staffIds[0],
        startsAt: day.at('10:30'),
        endsAt: day.at('11:30'),
        kind: 'break',
      })
      .expect(409);
    await h
      .http()
      .post(biz(v, `/branches/${v.branchId}/closures`))
      .set('Authorization', auth)
      .send({ startsAt: day.at('00:00'), endsAt: day.at('23:00'), reason: 'Maintenance' })
      .expect(409);
    await h
      .http()
      .patch(biz(v, `/branches/${v.branchId}`))
      .set('Authorization', auth)
      .send({ hours: later('11:00') })
      .expect(409);
    await h
      .http()
      .patch(biz(v, `/staff/${v.staffIds[0]}`))
      .set('Authorization', auth)
      .send({ status: 'archived' })
      .expect(409);

    // A block that does not touch the booking is fine and removes those slots.
    await h
      .http()
      .post(biz(v, '/blocks'))
      .set('Authorization', auth)
      .send({
        staffId: v.staffIds[0],
        startsAt: day.at('14:00'),
        endsAt: day.at('15:00'),
        kind: 'break',
      })
      .expect(201);
    const list = await starts(v, day.date);
    expect(list).not.toContain(day.at('14:00'));
    expect(list).toContain(day.at('15:00'));
    // The refused shift edit (from 12:00) was rolled back as a whole.
    expect(list).toContain(day.at('11:15'));
  });
});

describe('rescheduling', () => {
  it('moves a booking in place and keeps the original when the new time is taken', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const day = dubaiDay(h, 3);
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
    });
    await confirmedBooking(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('15:00'),
    });

    const taken = await h
      .http()
      .post(`/v1/bookings/${booking.id}/reschedule`)
      .set('Authorization', bearer(user))
      .send({ startAt: day.at('15:30') })
      .expect(409);
    expect(taken.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await getBooking(h, user, booking.id)).startAt).toBe(booking.startAt);

    // Overlapping its own current time is allowed.
    const res = await h
      .http()
      .post(`/v1/bookings/${booking.id}/reschedule`)
      .set('Authorization', bearer(user))
      .send({ startAt: day.at('10:30') })
      .expect(200);
    const moved = bookingSchema.parse(res.body);
    expect(moved.startAt).toBe(new Date(day.at('10:30')).toISOString());
    expect(moved.rescheduledCount).toBe(1);
    expect(moved.version).toBeGreaterThan(booking.version);
    expect(moved.status).toBe('confirmed');
    expect(await starts(v, day.date)).not.toContain(day.at('10:30'));

    await shiftBookingTo(h, booking.id, new Date(h.clock.now().getTime() + 3_600_000));
    const late = await h
      .http()
      .post(`/v1/bookings/${booking.id}/reschedule`)
      .set('Authorization', bearer(user))
      .send({ startAt: day.at('12:00') })
      .expect(422);
    expect(late.body.error.code).toBe('RESCHEDULE_NOT_ALLOWED');
  });
});

describe('business calendar', () => {
  it('adds manual bookings under the same rules and walks an appointment through its states', async () => {
    const v = await approvedVenue(h);
    const auth = bearer(v.owner);
    const day = dubaiDay(h, 3);
    const manual = await h
      .http()
      .post(biz(v, '/bookings'))
      .set('Authorization', auth)
      .send({
        branchId: v.branchId,
        serviceId: v.serviceId,
        staffId: v.staffIds[0],
        startAt: day.at('10:00'),
        customerName: 'Fictional Walk-in',
        customerPhone: '+971500000001',
      })
      .expect(201);
    const m = merchantBookingSchema.parse(manual.body);
    expect(m).toMatchObject({ status: 'confirmed', source: 'manual', paymentMode: 'pay_at_venue' });
    const clash = await holdRequest(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:30'),
    }).expect(409);
    expect(clash.body.error.code).toBe('SLOT_UNAVAILABLE');

    const early = await h
      .http()
      .post(biz(v, `/bookings/${m.id}/actions`))
      .set('Authorization', auth)
      .send({ action: 'check_in', expectedVersion: m.version })
      .expect(422);
    expect(early.body.error.code).toBe('TOO_EARLY');
    await h
      .http()
      .post(biz(v, `/bookings/${m.id}/actions`))
      .set('Authorization', auth)
      .send({ action: 'check_in', expectedVersion: m.version + 5 })
      .expect(409);

    await shiftBookingTo(h, m.id, new Date(h.clock.now().getTime() + 30 * 60_000));
    const checkedIn = merchantBookingSchema.parse(
      (
        await h
          .http()
          .post(biz(v, `/bookings/${m.id}/actions`))
          .set('Authorization', auth)
          .send({ action: 'check_in', expectedVersion: m.version })
          .expect(200)
      ).body,
    );
    expect(checkedIn.status).toBe('checked_in');
    const done = await h
      .http()
      .post(biz(v, `/bookings/${m.id}/actions`))
      .set('Authorization', auth)
      .send({ action: 'complete', expectedVersion: checkedIn.version })
      .expect(200);
    expect(done.body.status).toBe('completed');

    const page = pageSchema(merchantBookingSchema).parse(
      (
        await h
          .http()
          .get(biz(v, '/bookings'))
          .query({ from: dubaiDay(h, 0).date, to: day.date })
          .set('Authorization', auth)
          .expect(200)
      ).body,
    );
    expect(page.items.map((b) => b.id)).toContain(m.id);
  });

  it('shows professionals only their own appointments', async () => {
    const v = await approvedVenue(h, { staff: 2 });
    const day = dubaiDay(h, 3);
    const pro = await signUp(h, uniqueEmail('pro'));
    const membership = await h.db
      .insertInto('memberships')
      .values({
        business_id: v.businessId,
        user_id: pro.user.id,
        permissions: ['professional'],
        status: 'active',
        invited_by: v.owner.user.id,
        accepted_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h
      .http()
      .patch(biz(v, `/staff/${v.staffIds[0]}`))
      .set('Authorization', bearer(v.owner))
      .send({ membershipId: membership.id })
      .expect(200);
    const mine = await confirmedBooking(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      staffId: v.staffIds[0],
    });
    const theirs = await confirmedBooking(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      staffId: v.staffIds[1],
    });
    const list = await h
      .http()
      .get(biz(v, '/bookings'))
      .query({ from: day.date, to: day.date })
      .set('Authorization', bearer(pro))
      .expect(200);
    expect(list.body.items.map((b: { id: string }) => b.id)).toEqual([mine.id]);
    await h
      .http()
      .get(biz(v, `/bookings/${theirs.id}`))
      .set('Authorization', bearer(pro))
      .expect(404);
    await h
      .http()
      .post(biz(v, `/bookings/${mine.id}/actions`))
      .set('Authorization', bearer(pro))
      .send({ action: 'cancel', expectedVersion: mine.version })
      .expect(403);
    await h.http().post(biz(v, '/services')).set('Authorization', bearer(pro)).send({}).expect(403);
  });
});

describe('tenant isolation', () => {
  it('keeps businesses and customers apart', async () => {
    const a = await approvedVenue(h);
    const b = await approvedVenue(h);
    const user = await customer();
    const booking = await held(h, user, {
      branchId: a.branchId,
      serviceId: a.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    // Another business cannot read or act on it (non-members get 404, like a missing business).
    await h
      .http()
      .get(`/v1/businesses/${a.businessId}/bookings/${booking.id}`)
      .set('Authorization', bearer(b.owner))
      .expect(404);
    await h
      .http()
      .get(`/v1/businesses/${b.businessId}/bookings/${booking.id}`)
      .set('Authorization', bearer(b.owner))
      .expect(404);
    // Another business's branch or service cannot be referenced.
    await h
      .http()
      .post(`/v1/businesses/${b.businessId}/staff`)
      .set('Authorization', bearer(b.owner))
      .send({ displayName: 'Intruder', branchIds: [a.branchId], serviceIds: [] })
      .expect(422);
    await h
      .http()
      .post(`/v1/businesses/${b.businessId}/bookings`)
      .set('Authorization', bearer(b.owner))
      .send({
        branchId: a.branchId,
        serviceId: a.serviceId,
        staffId: a.staffIds[0],
        startAt: dubaiDay(h, 3).at('14:00'),
        customerName: 'Fictional',
      })
      .expect(404);
    // Another customer cannot see, pay or cancel it.
    const other = await customer();
    await h
      .http()
      .get(`/v1/bookings/${booking.id}`)
      .set('Authorization', bearer(other))
      .expect(404);
    await h
      .http()
      .post(`/v1/bookings/${booking.id}/pay`)
      .set('Authorization', bearer(other))
      .expect(404);
    await h
      .http()
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', bearer(other))
      .send({})
      .expect(404);
  });
});

describe('admin oversight', () => {
  it('lists bookings and suspends a service so it cannot be booked', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await held(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    const ops = await adminLogin(h, await provisionAdmin(h, ['operations']));
    const list = await h
      .http()
      .get('/v1/admin/bookings')
      .query({ businessId: v.businessId })
      .set('Authorization', bearer(ops))
      .expect(200);
    expect(list.body.items.map((b: { id: string }) => b.id)).toEqual([booking.id]);

    const service = (
      await h
        .http()
        .get('/v1/admin/services')
        .query({ status: 'all' })
        .set('Authorization', bearer(ops))
        .expect(200)
    ).body.items.find((s: { id: string }) => s.id === v.serviceId);
    const suspended = adminServiceSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/services/${v.serviceId}/actions`)
          .set('Authorization', bearer(ops))
          .send({
            action: 'suspend',
            reason: 'Listing under review',
            expectedVersion: service.version,
          })
          .expect(200)
      ).body,
    );
    expect(suspended.status).toBe('suspended');
    const venue = (await h.http().get(`/v1/venues/${v.businessId}`).expect(200)).body;
    expect(venue.services).toEqual([]);
    await holdRequest(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('14:00'),
    }).expect(404);
    const reactivate = await h
      .http()
      .patch(biz(v, `/services/${v.serviceId}`))
      .set('Authorization', bearer(v.owner))
      .send({ status: 'active' })
      .expect(409);
    expect(reactivate.body.error.code).toBe('SERVICE_SUSPENDED');
    // Support may monitor bookings but not take services down.
    const support = await adminLogin(h, await provisionAdmin(h, ['support']));
    await h.http().get('/v1/admin/bookings').set('Authorization', bearer(support)).expect(200);
    await h.http().get('/v1/admin/services').set('Authorization', bearer(support)).expect(403);
  });
});
