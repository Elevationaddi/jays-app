import {
  addonSchema,
  availabilitySchema,
  bookingSchema,
  mediaSchema,
  nextAvailableSchema,
  pageSchema,
  portfolioItemSchema,
  publicServiceListItemSchema,
  publicVenueSchema,
  rebookSchema,
  uploadTicketSchema,
  waitlistEntrySchema,
  waitlistListSchema,
} from '@jays/contracts';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../aftercare/notifications.service.js';
import {
  approvedVenue,
  confirmedBooking,
  dubaiDay,
  held,
  holdRequest,
  payBooking,
  type Venue,
} from '../testing/booking.js';
import {
  bearer,
  type Harness,
  putUpload,
  signUp,
  startHarness,
  uniqueEmail,
} from '../testing/harness.js';
import { renderPng } from '../testing/png.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const customer = () => signUp(h, uniqueEmail('discover'));
const biz = (v: Venue, path: string) => `/v1/businesses/${v.businessId}${path}`;

async function addAddon(v: Venue, body: Record<string, unknown>) {
  return addonSchema.parse(
    (
      await h
        .http()
        .post(biz(v, `/services/${v.serviceId}/addons`))
        .set('Authorization', bearer(v.owner))
        .send(body)
        .expect(201)
    ).body,
  );
}

const venueOf = async (v: Venue) =>
  publicVenueSchema.parse((await h.http().get(`/v1/venues/${v.businessId}`).expect(200)).body);

describe('add-ons', () => {
  it('lengthen availability, add to the price, are snapshotted and itemised on the invoice', async () => {
    const v = await approvedVenue(h);
    const colour = await addAddon(v, {
      title: { en: 'Colour gloss', ar: 'لمعان اللون' },
      priceFils: 2_000,
      durationMin: 15,
    });
    const mask = await addAddon(v, {
      title: { en: 'Hair mask', ar: 'قناع الشعر' },
      priceFils: 500,
      durationMin: 0,
      sortOrder: 1,
    });
    const venue = await venueOf(v);
    expect(venue.services[0]?.addons.map((a) => a.id)).toEqual([colour.id, mask.id]);

    // 60 + 15 minutes plus the 15-minute buffer: the last start moves from 16:45 to 16:30.
    const day = dubaiDay(h, 2);
    const withAddon = availabilitySchema.parse(
      (
        await h
          .http()
          .get('/v1/availability')
          .query({
            branchId: v.branchId,
            serviceId: v.serviceId,
            date: day.date,
            addonIds: colour.id,
          })
          .expect(200)
      ).body,
    );
    expect(withAddon.slots.at(-1)?.startAt).toBe(day.at('16:30'));

    const user = await customer();
    const booking = await held(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      addonIds: [colour.id],
    });
    expect(booking.priceFils).toBe(12_500);
    expect(booking.addonsFils).toBe(2_000);
    expect(booking.addons).toEqual([
      { id: colour.id, title: colour.title, priceFils: 2_000, durationMin: 15 },
    ]);
    expect(booking.endAt).toBe(day.at('11:15'));
    expect(booking.service.durationMin).toBe(75);

    // A later price change never touches the booking (T13).
    await h
      .http()
      .patch(biz(v, `/addons/${colour.id}`))
      .set('Authorization', bearer(v.owner))
      .send({ priceFils: 9_900 })
      .expect(200);

    await payBooking(h, user, booking.id);
    const invoice = await h.db
      .selectFrom('tax_documents')
      .select(['lines', 'total_fils', 'vat_fils'])
      .where('kind', '=', 'customer_invoice')
      .where('earning_id', 'in', (eb) =>
        eb.selectFrom('merchant_earnings').select('id').where('booking_id', '=', booking.id),
      )
      .executeTakeFirstOrThrow();
    expect(invoice.total_fils).toBe(12_500);
    expect(invoice.lines.map((l) => [l.description.en, l.totalFils, l.vatFils])).toEqual([
      ['Fictional haircut', 10_500, 500],
      ['Colour gloss', 2_000, 95],
    ]);
    // Commission applies to the service and its add-ons before VAT.
    const earning = await h.db
      .selectFrom('merchant_earnings')
      .select(['commission_base_fils'])
      .where('booking_id', '=', booking.id)
      .executeTakeFirstOrThrow();
    expect(earning.commission_base_fils).toBe(12_500 - 595);
  });

  it('rejects archived, foreign or repeated add-ons', async () => {
    const v = await approvedVenue(h);
    const other = await approvedVenue(h);
    const addon = await addAddon(v, {
      title: { en: 'Fringe', ar: 'غرة' },
      priceFils: 0,
      durationMin: 5,
    });
    const foreign = await addAddon(other, {
      title: { en: 'Other', ar: 'أخرى' },
      priceFils: 100,
      durationMin: 5,
    });
    const user = await customer();
    const startAt = dubaiDay(h, 3).at('10:00');
    const base = { branchId: v.branchId, serviceId: v.serviceId, startAt };
    const foreignRes = await holdRequest(h, user, { ...base, addonIds: [foreign.id] });
    expect(foreignRes.status).toBe(422);
    expect(foreignRes.body.error.code).toBe('ADDON_NOT_AVAILABLE');
    const repeated = await holdRequest(h, user, { ...base, addonIds: [addon.id, addon.id] });
    expect(repeated.status).toBe(422);
    await h
      .http()
      .patch(biz(v, `/addons/${addon.id}`))
      .set('Authorization', bearer(v.owner))
      .send({ status: 'archived' })
      .expect(200);
    const archived = await holdRequest(h, user, { ...base, addonIds: [addon.id] });
    expect(archived.body.error.code).toBe('ADDON_NOT_AVAILABLE');
    expect((await venueOf(v)).services[0]?.addons).toEqual([]);
    // Another business cannot edit it.
    await h
      .http()
      .patch(biz(other, `/addons/${addon.id}`))
      .set('Authorization', bearer(other.owner))
      .send({ priceFils: 1 })
      .expect(404);
  });
});

describe('search, profiles and next available', () => {
  it('finds visible services by text and filters, with ratings from real reviews only', async () => {
    const tag = `Zq${Date.now() % 1e6}`;
    const cheap = await approvedVenue(h, { service: { priceFils: 5_000 } });
    const dear = await approvedVenue(h, { service: { priceFils: 30_000 } });
    for (const v of [cheap, dear]) {
      await h
        .http()
        .patch(biz(v, `/services/${v.serviceId}`))
        .set('Authorization', bearer(v.owner))
        .send({ title: { en: `${tag} blow-dry`, ar: `${tag} تجفيف` } })
        .expect(200);
    }
    const search = async (query: Record<string, string | number>) =>
      pageSchema(publicServiceListItemSchema).parse(
        (
          await h
            .http()
            .get('/v1/services')
            .query({ q: tag, ...query })
            .expect(200)
        ).body,
      );
    expect((await search({ sort: 'price_asc' })).items.map((s) => s.id)).toEqual([
      cheap.serviceId,
      dear.serviceId,
    ]);
    expect((await search({ sort: 'price_desc' })).items[0]?.id).toBe(dear.serviceId);
    expect((await search({ maxPriceFils: 10_000 })).items.map((s) => s.id)).toEqual([
      cheap.serviceId,
    ]);
    expect((await search({ location: 'home' })).items).toEqual([]);
    const first = await search({ limit: 1, sort: 'price_asc' });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await search({ limit: 1, sort: 'price_asc', cursor: first.nextCursor! });
    expect(second.items[0]?.id).toBe(dear.serviceId);
    expect(first.items[0]).toMatchObject({ emirates: ['DXB'], rating: null, addonCount: 0 });

    // A published review of a completed appointment counts; minRating filters on it.
    const user = await customer();
    const b = await confirmedBooking(h, user, {
      branchId: dear.branchId,
      serviceId: dear.serviceId,
      startAt: dubaiDay(h, 2).at('10:00'),
    });
    await h.db
      .insertInto('reviews')
      .values({
        user_id: user.user.id,
        business_id: dear.businessId,
        target_type: 'booking',
        booking_id: b.id,
        service_id: dear.serviceId,
        rating: 4,
      })
      .execute();
    const rated = await search({ minRating: 4 });
    expect(rated.items.map((s) => s.id)).toEqual([dear.serviceId]);
    expect(rated.items[0]?.rating).toEqual({ average: 4, count: 1 });
    const venue = await venueOf(dear);
    expect(venue.rating).toEqual({ average: 4, count: 1 });
    expect(venue.staff[0]?.rating).toEqual({ average: 4, count: 1 });

    // A business whose services mode is suspended disappears at once.
    await h.db
      .updateTable('business_modes')
      .set({ status: 'suspended' })
      .where('business_id', '=', cheap.businessId)
      .execute();
    expect((await search({})).items.map((s) => s.id)).toEqual([dear.serviceId]);
  });

  it('shows professional bios and the next free time', async () => {
    const v = await approvedVenue(h);
    await h
      .http()
      .patch(biz(v, `/staff/${v.staffIds[0]}`))
      .set('Authorization', bearer(v.owner))
      .send({ bio: { en: 'Ten years of fictional cuts.', ar: 'عشر سنوات من القصات التجريبية.' } })
      .expect(200);
    expect((await venueOf(v)).staff[0]?.bio?.en).toBe('Ten years of fictional cuts.');

    // Fill the whole of today and tomorrow is the answer, or later today if time remains.
    const next = nextAvailableSchema.parse(
      (await h.http().get(`/v1/services/${v.serviceId}/next-available`).expect(200)).body,
    );
    expect(next.branchId).toBe(v.branchId);
    expect(next.startAt).not.toBeNull();
    expect(new Date(next.startAt!).getTime()).toBeGreaterThan(h.clock.now().getTime());
    expect(next.staffIds).toEqual(v.staffIds);
    // Home visits are not offered here: nothing.
    const home = nextAvailableSchema.parse(
      (
        await h
          .http()
          .get(`/v1/services/${v.serviceId}/next-available`)
          .query({ location: 'home' })
          .expect(200)
      ).body,
    );
    expect(home.startAt).toBeNull();
  });
});

describe('portfolio', () => {
  it('uploads a checked photo, tags it to a service and shows it on the venue', async () => {
    const v = await approvedVenue(h);
    const png = renderPng(800, 800, { from: [40, 40, 90], to: [200, 180, 220] });
    const ticket = uploadTicketSchema.parse(
      (
        await h
          .http()
          .post(biz(v, '/portfolio-images'))
          .set('Authorization', bearer(v.owner))
          .send({ contentType: 'image/png', sizeBytes: png.length })
          .expect(201)
      ).body,
    );
    await putUpload(h, ticket, png).expect(200);
    const media = mediaSchema.parse(
      (
        await h
          .http()
          .post(biz(v, `/portfolio-images/${ticket.id}/complete`))
          .set('Authorization', bearer(v.owner))
          .expect(200)
      ).body,
    );
    expect(media.status).toBe('ready');
    const item = portfolioItemSchema.parse(
      (
        await h
          .http()
          .post(biz(v, '/portfolio'))
          .set('Authorization', bearer(v.owner))
          .send({
            mediaId: media.id,
            serviceId: v.serviceId,
            caption: { en: 'Fictional layered cut', ar: 'قصة متدرجة تجريبية' },
          })
          .expect(201)
      ).body,
    );
    // The same photo cannot be added twice.
    await h
      .http()
      .post(biz(v, '/portfolio'))
      .set('Authorization', bearer(v.owner))
      .send({ mediaId: media.id })
      .expect(409);
    const venue = await venueOf(v);
    expect(venue.portfolio.map((p) => [p.id, p.serviceId])).toEqual([[item.id, v.serviceId]]);
    const redirect = await h.http().get(`/v1/media/${media.id}`).expect(302);
    expect(redirect.headers.location).toBeTruthy();

    await h
      .http()
      .delete(biz(v, `/portfolio/${item.id}`))
      .set('Authorization', bearer(v.owner))
      .expect(200);
    expect((await venueOf(v)).portfolio).toEqual([]);
    await h.http().get(`/v1/media/${media.id}`).expect(404);
  });
});

describe('waitlist and reminders', () => {
  it('tells waiting customers once when a matching appointment is canceled', async () => {
    const v = await approvedVenue(h);
    const day = dubaiDay(h, 4);
    const [first, waiting, late] = await Promise.all([customer(), customer(), customer()]);
    const booking = await confirmedBooking(h, first, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
    });
    const join = (who: typeof first, windowStart: string, windowEnd: string) =>
      h.http().post('/v1/me/waitlist').set('Authorization', bearer(who)).send({
        branchId: v.branchId,
        serviceId: v.serviceId,
        date: day.date,
        windowStart,
        windowEnd,
      });
    const entry = waitlistEntrySchema.parse(
      (await join(waiting, '09:00', '12:00').expect(200)).body,
    );
    expect(entry).toMatchObject({ status: 'active', date: day.date, windowStart: '09:00' });
    // Joining again updates the same entry; a window that misses 10:00 is not told.
    await join(late, '14:00', '16:00').expect(200);
    const again = waitlistEntrySchema.parse(
      (await join(waiting, '09:30', '12:00').expect(200)).body,
    );
    expect(again.id).toBe(entry.id);

    await h
      .http()
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', bearer(first))
      .send({})
      .expect(200);

    const events = await h.db
      .selectFrom('outbox')
      .select(['id', 'payload'])
      .where('event_type', '=', 'booking.waitlist_opened')
      .execute();
    const mine = events.filter(
      (e) => (e.payload as { waitlistId: string }).waitlistId === entry.id,
    );
    expect(mine).toHaveLength(1);
    const lateEvents = events.filter(
      (e) => (e.payload as { userId: string }).userId === late.user.id,
    );
    expect(lateEvents).toHaveLength(0);
    const list = waitlistListSchema.parse(
      (await h.http().get('/v1/me/waitlist').set('Authorization', bearer(waiting)).expect(200))
        .body,
    );
    expect(list.items[0]?.status).toBe('notified');

    await h.app.get(NotificationsService).dispatch(10, [mine[0]!.id]);
    const note = await h.db
      .selectFrom('notifications')
      .select(['title', 'link'])
      .where('user_id', '=', waiting.user.id)
      .where('event_type', '=', 'booking.waitlist_opened')
      .executeTakeFirstOrThrow();
    expect(note.title).toMatch(/^A time opened at Fictional Salon/);
    expect(note.link).toBe(`/venues/${v.businessId}/services/${v.serviceId}`);

    // Leaving removes it from the list.
    await h
      .http()
      .delete(`/v1/me/waitlist/${entry.id}`)
      .set('Authorization', bearer(waiting))
      .expect(200);
  });

  it('rejects professionals who do not offer the service and caps active entries', async () => {
    const v = await approvedVenue(h);
    const other = await approvedVenue(h);
    const user = await customer();
    const body = (days: number, extra: Record<string, unknown> = {}) => ({
      branchId: v.branchId,
      serviceId: v.serviceId,
      date: dubaiDay(h, days).date,
      ...extra,
    });
    await h
      .http()
      .post('/v1/me/waitlist')
      .set('Authorization', bearer(user))
      .send(body(2, { staffId: other.staffIds[0] }))
      .expect(400);
    for (let d = 2; d < 7; d++) {
      await h
        .http()
        .post('/v1/me/waitlist')
        .set('Authorization', bearer(user))
        .send(body(d))
        .expect(200);
    }
    const capped = await h
      .http()
      .post('/v1/me/waitlist')
      .set('Authorization', bearer(user))
      .send(body(8))
      .expect(409);
    expect(capped.body.error.code).toBe('WAITLIST_LIMIT');
    await h
      .http()
      .post('/v1/me/waitlist')
      .set('Authorization', bearer(user))
      .send(body(70))
      .expect(422);
  });

  it('queues one reminder about a day ahead, never for a last-minute booking', async () => {
    const v = await approvedVenue(h);
    const user = await customer();
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 5).at('10:00'),
    });
    const remind = async (at: Date) =>
      Number(
        (
          await sql<{ n: number }>`SELECT queue_booking_reminders(${at}, 24, 500) AS n`.execute(
            h.db,
          )
        ).rows[0]?.n,
      );
    const start = new Date(booking.startAt).getTime();
    // Two days before: not yet.
    await remind(new Date(start - 48 * 3_600_000));
    const early = await h.db
      .selectFrom('bookings')
      .select('reminder_sent_at')
      .where('id', '=', booking.id)
      .executeTakeFirstOrThrow();
    expect(early.reminder_sent_at).toBeNull();
    // Twenty hours before: once, and only once.
    await remind(new Date(start - 20 * 3_600_000));
    await remind(new Date(start - 19 * 3_600_000));
    const events = await h.db
      .selectFrom('outbox')
      .select('id')
      .where('event_type', '=', 'booking.reminder')
      .where(sql<boolean>`payload->>'bookingId' = ${booking.id}`)
      .execute();
    expect(events).toHaveLength(1);
    // Queued for "twenty hours before", which is days away for the test clock: release it now.
    await h.db
      .updateTable('outbox')
      .set({ available_at: h.clock.now() })
      .where('id', '=', events[0]!.id)
      .execute();
    await h.app.get(NotificationsService).dispatch(10, [events[0]!.id]);
    const note = await h.db
      .selectFrom('notifications')
      .select(['title', 'link'])
      .where('user_id', '=', user.user.id)
      .where('event_type', '=', 'booking.reminder')
      .executeTakeFirstOrThrow();
    expect(note.title).toMatch(/^Reminder: Fictional Salon/);
    expect(note.link).toBe(`/bookings/${booking.id}`);
  });
});

describe('rebooking', () => {
  it('prefills the same service, professional and add-ons, and says what changed', async () => {
    const v = await approvedVenue(h, { staff: 2 });
    const addon = await addAddon(v, {
      title: { en: 'Scalp massage', ar: 'تدليك فروة الرأس' },
      priceFils: 1_000,
      durationMin: 10,
    });
    const user = await customer();
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 2).at('10:00'),
      staffId: v.staffIds[1],
      addonIds: [addon.id],
    });
    const rebook = async () =>
      rebookSchema.parse(
        (
          await h
            .http()
            .get(`/v1/bookings/${booking.id}/rebook`)
            .set('Authorization', bearer(user))
            .expect(200)
        ).body,
      );
    expect(await rebook()).toMatchObject({
      venueId: v.businessId,
      serviceId: v.serviceId,
      staffId: v.staffIds[1],
      addonIds: [addon.id],
      location: 'venue',
      available: true,
      changes: [],
    });
    await h
      .http()
      .patch(biz(v, `/addons/${addon.id}`))
      .set('Authorization', bearer(v.owner))
      .send({ status: 'archived' })
      .expect(200);
    await h
      .http()
      .patch(biz(v, `/services/${v.serviceId}`))
      .set('Authorization', bearer(v.owner))
      .send({ priceFils: 11_000 })
      .expect(200);
    const changed = await rebook();
    expect(changed.addonIds).toEqual([]);
    expect(changed.changes.sort()).toEqual(['addon_unavailable', 'price_changed']);
    expect(changed.priceFils).toBe(11_000);
    // Someone else's appointment is not found.
    await h
      .http()
      .get(`/v1/bookings/${booking.id}/rebook`)
      .set('Authorization', bearer(await customer()))
      .expect(404);
    bookingSchema.parse(booking);
  });
});
