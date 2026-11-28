import {
  adminHomeServiceSchema,
  availabilitySchema,
  bookingSchema,
  homeServiceProfileSchema,
  pageSchema,
  publicVenueSchema,
  uploadTicketSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approvedVenue,
  dubaiDay,
  holdRequest,
  payBooking,
  type Venue,
} from '../testing/booking.js';
import {
  adminLogin,
  bearer,
  type Harness,
  provisionAdmin,
  putUpload,
  signUp,
  startHarness,
  uniqueEmail,
} from '../testing/harness.js';
import { fictionalPdf } from '../testing/png.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const customer = () => signUp(h, uniqueEmail('home-booker'));

async function addAddress(
  session: Awaited<ReturnType<typeof customer>>,
  emirate: string,
  area: string,
) {
  const res = await h
    .http()
    .post('/v1/me/addresses')
    .set('Authorization', bearer(session))
    .send({ emirate, area, street: 'Fictional Street 4', building: 'Villa 12' })
    .expect(201);
  return res.body.id as string;
}

async function uploadLicence(v: Venue) {
  const bytes = fictionalPdf('Fictional home service licence');
  const ticket = uploadTicketSchema.parse(
    (
      await h
        .http()
        .post(`/v1/businesses/${v.businessId}/documents`)
        .set('Authorization', bearer(v.owner))
        .send({
          kind: 'home_service_license',
          fileName: 'home-licence.pdf',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
        })
        .expect(201)
    ).body,
  );
  await putUpload(h, ticket, bytes).expect(200);
  await h
    .http()
    .post(`/v1/businesses/${v.businessId}/documents/${ticket.id}/complete`)
    .set('Authorization', bearer(v.owner))
    .expect(200);
  return ticket.id;
}

const profileBody = (documentId: string | null, over: Record<string, unknown> = {}) => ({
  licenseNumber: 'HS-2026-0042',
  licenseAuthority: 'Fictional Licensing Authority',
  licenseExpiry: '2030-06-30',
  licenseDocumentId: documentId,
  travelBufferMin: 30,
  minOrderFils: 10_000,
  areas: [
    { emirate: 'DXB', area: null, travelFeeFils: 3_000 },
    { emirate: 'DXB', area: 'Dubai Marina', travelFeeFils: 1_500 },
  ],
  ...over,
});

/** A venue approved for home visits, with its service offered at the venue and at home. */
async function homeVenue() {
  const v = await approvedVenue(h);
  const base = `/v1/businesses/${v.businessId}`;
  const auth = bearer(v.owner);
  const doc = await uploadLicence(v);
  await h
    .http()
    .put(`${base}/home-services`)
    .set('Authorization', auth)
    .send(profileBody(doc))
    .expect(200);
  const submitted = homeServiceProfileSchema.parse(
    (await h.http().post(`${base}/home-services/submit`).set('Authorization', auth).expect(200))
      .body,
  );
  const admin = bearer(await adminLogin(h, await provisionAdmin(h, ['compliance'])));
  await h
    .http()
    .post(`/v1/admin/home-services/${v.businessId}/decision`)
    .set('Authorization', admin)
    .send({ decision: 'approve', expectedVersion: submitted.version })
    .expect(200);
  await h
    .http()
    .patch(`${base}/services/${v.serviceId}`)
    .set('Authorization', auth)
    .send({ locationMode: 'both' })
    .expect(200);
  return { v, admin };
}

async function starts(v: Venue, date: string, location: 'venue' | 'home') {
  const res = await h
    .http()
    .get('/v1/availability')
    .query({ branchId: v.branchId, serviceId: v.serviceId, date, location })
    .expect(200);
  return availabilitySchema.parse(res.body).slots.map((s) => s.startAt);
}

describe('home-service licence review (D9)', () => {
  it('needs a complete, approved licence before services can go to customers', async () => {
    const v = await approvedVenue(h);
    const base = `/v1/businesses/${v.businessId}`;
    const auth = bearer(v.owner);

    const blank = homeServiceProfileSchema.parse(
      (await h.http().get(`${base}/home-services`).set('Authorization', auth).expect(200)).body,
    );
    expect(blank).toMatchObject({ status: 'draft', active: false, areas: [], version: 0 });

    const early = await h
      .http()
      .patch(`${base}/services/${v.serviceId}`)
      .set('Authorization', auth)
      .send({ locationMode: 'home' })
      .expect(409);
    expect(early.body.error.code).toBe('HOME_SERVICES_NOT_APPROVED');

    const incomplete = await h
      .http()
      .post(`${base}/home-services/submit`)
      .set('Authorization', auth)
      .expect(422);
    expect(incomplete.body.error.code).toBe('HOME_PROFILE_INCOMPLETE');
    expect(Object.keys(incomplete.body.error.fieldErrors)).toEqual(
      expect.arrayContaining(['licenseNumber', 'licenseDocumentId', 'areas']),
    );

    // A trade-licence document is not a home-service licence.
    const wrongDoc = await h.db
      .insertInto('verification_documents')
      .values({
        business_id: v.businessId,
        kind: 'trade_license',
        object_key: `private/${v.businessId}/fictional-${Date.now()}.pdf`,
        file_name: 'trade.pdf',
        content_type: 'application/pdf',
        declared_size_bytes: 10,
        upload_expires_at: new Date(),
        uploaded_by: v.owner.user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h
      .http()
      .put(`${base}/home-services`)
      .set('Authorization', auth)
      .send(profileBody(wrongDoc.id))
      .expect(400);

    const duplicate = await h
      .http()
      .put(`${base}/home-services`)
      .set('Authorization', auth)
      .send(
        profileBody(null, {
          areas: [
            { emirate: 'DXB', area: 'Marina', travelFeeFils: 1 },
            { emirate: 'DXB', area: ' marina ', travelFeeFils: 2 },
          ],
        }),
      )
      .expect(400);
    expect(duplicate.body.error.code).toBe('VALIDATION_FAILED');

    // The licence can be uploaded although the business is already approved.
    const doc = await uploadLicence(v);
    await h
      .http()
      .put(`${base}/home-services`)
      .set('Authorization', auth)
      .send(profileBody(doc))
      .expect(200);
    const pending = homeServiceProfileSchema.parse(
      (await h.http().post(`${base}/home-services/submit`).set('Authorization', auth).expect(200))
        .body,
    );
    expect(pending).toMatchObject({ status: 'pending', licenseEditable: false, active: false });
    expect(pending.licenseDocument).toMatchObject({ id: doc, status: 'clean' });

    const locked = await h
      .http()
      .put(`${base}/home-services`)
      .set('Authorization', auth)
      .send(profileBody(doc, { licenseNumber: 'HS-OTHER-1' }))
      .expect(409);
    expect(locked.body.error.code).toBe('HOME_PROFILE_LOCKED');
    // Travel terms and areas can still change.
    const retuned = homeServiceProfileSchema.parse(
      (
        await h
          .http()
          .put(`${base}/home-services`)
          .set('Authorization', auth)
          .send(profileBody(doc, { travelBufferMin: 20 }))
          .expect(200)
      ).body,
    );
    expect(retuned).toMatchObject({ status: 'pending', travelBufferMin: 20 });

    const admin = bearer(await adminLogin(h, await provisionAdmin(h, ['compliance'])));
    const queue = pageSchema(adminHomeServiceSchema).parse(
      (
        await h
          .http()
          .get('/v1/admin/home-services')
          .query({ status: 'pending', limit: 100 })
          .set('Authorization', admin)
          .expect(200)
      ).body,
    );
    expect(queue.items.map((i) => i.businessId)).toContain(v.businessId);

    const stale = await h
      .http()
      .post(`/v1/admin/home-services/${v.businessId}/decision`)
      .set('Authorization', admin)
      .send({ decision: 'approve', expectedVersion: pending.version })
      .expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    await h
      .http()
      .post(`/v1/admin/home-services/${v.businessId}/decision`)
      .set('Authorization', admin)
      .send({ decision: 'reject', expectedVersion: retuned.version })
      .expect(400);
    const rejected = adminHomeServiceSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/home-services/${v.businessId}/decision`)
          .set('Authorization', admin)
          .send({
            decision: 'reject',
            reason: 'The licence scan is unreadable.',
            expectedVersion: retuned.version,
          })
          .expect(200)
      ).body,
    );
    expect(rejected).toMatchObject({ status: 'rejected', reviewReason: expect.any(String) });

    // Rejected: fix the licence and send it again.
    await h
      .http()
      .put(`${base}/home-services`)
      .set('Authorization', auth)
      .send(profileBody(doc, { licenseNumber: 'HS-2026-0043' }))
      .expect(200);
    const again = homeServiceProfileSchema.parse(
      (await h.http().post(`${base}/home-services/submit`).set('Authorization', auth).expect(200))
        .body,
    );
    const approved = adminHomeServiceSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/home-services/${v.businessId}/decision`)
          .set('Authorization', admin)
          .send({ decision: 'approve', expectedVersion: again.version })
          .expect(200)
      ).body,
    );
    expect(approved).toMatchObject({
      status: 'approved',
      active: true,
      licenseNumber: 'HS-2026-0043',
    });

    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('business_id', '=', v.businessId)
      .where('action', 'like', 'home_services.%')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'home_services.updated',
        'home_services.submitted',
        'home_services.reject',
        'home_services.approve',
      ]),
    );

    // Someone outside the business cannot see it.
    const stranger = await customer();
    await h.http().get(`${base}/home-services`).set('Authorization', bearer(stranger)).expect(404);
  });
});

describe('home visits', () => {
  it('prices travel, keeps travel time free and checks coverage and minimums', async () => {
    const { v } = await homeVenue();
    const day = dubaiDay(h, 3);

    const venue = publicVenueSchema.parse(
      (await h.http().get(`/v1/venues/${v.businessId}`).expect(200)).body,
    );
    expect(venue.services[0]).toMatchObject({ locationMode: 'both' });
    expect(venue.homeServices).toEqual({
      minOrderFils: 10_000,
      areas: expect.arrayContaining([
        { emirate: 'DXB', area: null, travelFeeFils: 3_000 },
        { emirate: 'DXB', area: 'Dubai Marina', travelFeeFils: 1_500 },
      ]),
    });

    // The first home slot leaves 30 minutes of travel inside the 09:00 shift.
    const homeStarts = await starts(v, day.date, 'home');
    const venueStarts = await starts(v, day.date, 'venue');
    expect(venueStarts).toContain(day.at('09:00'));
    expect(homeStarts).not.toContain(day.at('09:00'));
    expect(homeStarts).toContain(day.at('09:30'));

    const user = await customer();
    const marina = await addAddress(user, 'DXB', '  dubai   marina');
    const deira = await addAddress(user, 'DXB', 'Deira');
    const sharjah = await addAddress(user, 'SHJ', 'Al Majaz');

    const missing = await holdRequest(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      location: 'home',
    } as never).expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');

    const uncovered = await holdRequest(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      location: 'home',
      addressId: sharjah,
    } as never).expect(422);
    expect(uncovered.body.error.code).toBe('ADDRESS_NOT_COVERED');

    const other = await customer();
    await holdRequest(h, other, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      location: 'home',
      addressId: marina,
    } as never).expect(400);

    const res = await holdRequest(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      location: 'home',
      addressId: marina,
    } as never).expect(201);
    const booking = bookingSchema.parse(res.body);
    expect(booking).toMatchObject({
      location: 'home',
      travelFeeFils: 1_500,
      priceFils: 12_000,
      homeAddress: { addressId: marina, emirate: 'DXB', building: 'Villa 12' },
    });
    // 5% VAT included in 120.00.
    expect(booking.taxFils).toBe(571);
    const row = await h.db
      .selectFrom('bookings')
      .select(['occupied_start', 'occupied_end', 'travel_buffer_min'])
      .where('id', '=', booking.id)
      .executeTakeFirstOrThrow();
    expect(row.travel_buffer_min).toBe(30);
    expect(row.occupied_start.toISOString()).toBe(day.at('09:30'));
    // 60 minutes, 15 minutes service buffer, 30 minutes travel.
    expect(row.occupied_end.toISOString()).toBe(day.at('11:45'));

    // One professional: nothing else fits until the travel time is over.
    const after = await starts(v, day.date, 'venue');
    expect(after).not.toContain(day.at('11:30'));
    expect(after).toContain(day.at('11:45'));

    await payBooking(h, user, booking.id);
    const invoice = await h.db
      .selectFrom('tax_documents')
      .select(['lines', 'total_fils', 'vat_fils'])
      .where('kind', '=', 'customer_invoice')
      .where('earning_id', 'in', (eb) =>
        eb.selectFrom('merchant_earnings').select('id').where('booking_id', '=', booking.id),
      )
      .executeTakeFirstOrThrow();
    expect(invoice.total_fils).toBe(12_000);
    expect(invoice.lines.map((l) => [l.totalFils, l.vatFils])).toEqual([
      [10_500, 500],
      [1_500, 71],
    ]);
    expect(invoice.lines[1]!.description.en).toBe('Travel fee');
    // Commission is worked out on the service before VAT (100.00), never on the travel fee.
    const earning = await h.db
      .selectFrom('merchant_earnings')
      .select(['gross_fils', 'commission_base_fils', 'commission_bps', 'commission_fils'])
      .where('booking_id', '=', booking.id)
      .executeTakeFirstOrThrow();
    expect(earning.gross_fils).toBe(12_000);
    expect(earning.commission_base_fils).toBe(10_000);
    expect(earning.commission_fils).toBe(Math.round((10_000 * earning.commission_bps) / 10_000));

    // Rescheduling keeps the travel time it was booked with.
    await h
      .http()
      .post(`/v1/bookings/${booking.id}/reschedule`)
      .set('Authorization', bearer(user))
      .send({ startAt: day.at('14:00') })
      .expect(200);
    const moved = await h.db
      .selectFrom('bookings')
      .select(['occupied_start', 'occupied_end'])
      .where('id', '=', booking.id)
      .executeTakeFirstOrThrow();
    expect(moved.occupied_start.toISOString()).toBe(day.at('13:30'));
    expect(moved.occupied_end.toISOString()).toBe(day.at('15:45'));

    // The emirate-wide rule covers other areas at its own fee.
    const deiraHold = bookingSchema.parse(
      (
        await holdRequest(h, user, {
          branchId: v.branchId,
          serviceId: v.serviceId,
          startAt: day.at('10:00'),
          location: 'home',
          addressId: deira,
        } as never).expect(201)
      ).body,
    );
    expect(deiraHold).toMatchObject({ travelFeeFils: 3_000, priceFils: 13_500 });

    // Below the minimum, a home visit is refused; the venue still works.
    await h.db
      .updateTable('home_service_profiles')
      .set({ min_order_fils: 20_000 })
      .where('business_id', '=', v.businessId)
      .execute();
    const small = await holdRequest(h, await customer(), {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('16:00'),
      location: 'home',
      addressId: marina,
    } as never);
    // The address belongs to `user`, so another customer cannot use it at all.
    expect(small.status).toBe(400);
    const below = await holdRequest(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('16:00'),
      location: 'home',
      addressId: marina,
    } as never).expect(422);
    expect(below.body.error.code).toBe('BELOW_HOME_MINIMUM');
  });

  it('stops home bookings when suspended, and a home-only service has no venue option', async () => {
    const { v, admin } = await homeVenue();
    const base = `/v1/businesses/${v.businessId}`;
    await h
      .http()
      .patch(`${base}/services/${v.serviceId}`)
      .set('Authorization', bearer(v.owner))
      .send({ locationMode: 'home' })
      .expect(200);
    const day = dubaiDay(h, 4);
    const venueOnly = await h
      .http()
      .get('/v1/availability')
      .query({ branchId: v.branchId, serviceId: v.serviceId, date: day.date })
      .expect(422);
    expect(venueOnly.body.error.code).toBe('LOCATION_NOT_OFFERED');

    const current = adminHomeServiceSchema.parse(
      (
        await h
          .http()
          .get(`/v1/admin/home-services/${v.businessId}`)
          .set('Authorization', admin)
          .expect(200)
      ).body,
    );
    await h
      .http()
      .post(`/v1/admin/home-services/${v.businessId}/decision`)
      .set('Authorization', admin)
      .send({
        decision: 'suspend',
        reason: 'Licence under investigation.',
        expectedVersion: current.version,
      })
      .expect(200);

    const venue = publicVenueSchema.parse(
      (await h.http().get(`/v1/venues/${v.businessId}`).expect(200)).body,
    );
    expect(venue.homeServices).toBeNull();
    expect(venue.services).toEqual([]);
    const user = await customer();
    const address = await addAddress(user, 'DXB', 'Dubai Marina');
    const refused = await holdRequest(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: day.at('10:00'),
      location: 'home',
      addressId: address,
    } as never).expect(422);
    expect(refused.body.error.code).toBe('HOME_SERVICES_NOT_AVAILABLE');
  });

  it('clears the visit address when the customer account is deleted', async () => {
    const { v } = await homeVenue();
    const user = await customer();
    const address = await addAddress(user, 'DXB', 'Dubai Marina');
    const booking = bookingSchema.parse(
      (
        await holdRequest(h, user, {
          branchId: v.branchId,
          serviceId: v.serviceId,
          startAt: dubaiDay(h, 5).at('10:00'),
          location: 'home',
          addressId: address,
        } as never).expect(201)
      ).body,
    );
    await h.db
      .updateTable('users')
      .set({ deleted_at: h.clock.now(), status: 'deactivated' })
      .where('id', '=', user.user.id)
      .execute();
    const row = await h.db
      .selectFrom('bookings')
      .select(['home_address', 'customer_name', 'customer_phone'])
      .where('id', '=', booking.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      customer_name: null,
      customer_phone: null,
      home_address: { street: 'deleted', building: 'deleted', directions: null, emirate: 'DXB' },
    });
  });
});
