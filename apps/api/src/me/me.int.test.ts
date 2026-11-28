import { addressSchema, emirateListSchema, meSchema, pageSchema } from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminEmirateListSchema } from '@jays/contracts';
import { approvedVenue, dubaiDay, holdRequest } from '../testing/booking.js';
import {
  adminLogin,
  bearer,
  type Harness,
  provisionAdmin,
  signUp,
  startHarness,
} from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const address = {
  emirate: 'DXB',
  area: 'Fictional Marina',
  street: 'Example Street 1',
  building: 'Tower A',
};

describe('reference data', () => {
  it('lists the seven emirates in English and Arabic without signing in', async () => {
    const res = await h.http().get('/v1/emirates').expect(200);
    const { items } = emirateListSchema.parse(res.body);
    expect(items.map((e) => e.code)).toEqual(['AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ']);
    expect(items[1]?.name).toEqual({ en: 'Dubai', ar: 'دبي' });
  });
});

describe('profile', () => {
  it('updates language, emirate and preferred mode', async () => {
    const session = await signUp(h);
    const res = await h
      .http()
      .patch('/v1/me')
      .set('Authorization', bearer(session))
      .send({
        locale: 'ar',
        emirate: 'SHJ',
        preferredMode: 'services',
        displayName: 'Fictional Noor',
      })
      .expect(200);
    expect(meSchema.parse(res.body)).toMatchObject({
      locale: 'ar',
      emirate: 'SHJ',
      preferredMode: 'services',
      marketing: { email: false, sms: false, push: false },
    });
    // Consent moved to PATCH /me/privacy, which records its history.
    await h
      .http()
      .patch('/v1/me')
      .set('Authorization', bearer(session))
      .send({ marketingConsent: true })
      .expect(400);
    await h
      .http()
      .patch('/v1/me')
      .set('Authorization', bearer(session))
      .send({ emirate: 'XX' })
      .expect(400);
    await h
      .http()
      .patch('/v1/me')
      .set('Authorization', bearer(session))
      .send({ email: 'new@example.test' })
      .expect(400);
  });

  it('refuses an emirate an admin has switched off', async () => {
    const session = await signUp(h);
    await h.db.updateTable('emirates').set({ enabled: false }).where('code', '=', 'FUJ').execute();
    try {
      const res = await h
        .http()
        .patch('/v1/me')
        .set('Authorization', bearer(session))
        .send({ emirate: 'FUJ' })
        .expect(422);
      expect(res.body.error.code).toBe('EMIRATE_NOT_AVAILABLE');
      const list = await h.http().get('/v1/emirates').expect(200);
      expect(list.body.items.map((e: { code: string }) => e.code)).not.toContain('FUJ');
    } finally {
      await h.db.updateTable('emirates').set({ enabled: true }).where('code', '=', 'FUJ').execute();
    }
  });
});

// Emirate switches live here, next to the other FUJ test, because files run in parallel and the
// public emirate list is shared.
describe('operations by emirate (D11)', () => {
  it('lets operations admins switch an emirate off, which stops bookings and hides branches there', async () => {
    const ops = bearer(await adminLogin(h, await provisionAdmin(h, ['operations'])));
    const finance = bearer(await adminLogin(h, await provisionAdmin(h, ['finance'])));
    await h.http().get('/v1/admin/operations/emirates').set('Authorization', finance).expect(403);
    const v = await approvedVenue(h);
    await h.db
      .updateTable('branches')
      .set({ emirate_code: 'FUJ' })
      .where('id', '=', v.branchId)
      .execute();
    const customer = await signUp(h);
    const fujAddress = await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', bearer(customer))
      .send({ ...address, emirate: 'FUJ' })
      .expect(201);
    try {
      const res = await h
        .http()
        .patch('/v1/admin/operations/emirates/FUJ')
        .set('Authorization', ops)
        .send({ enabled: false })
        .expect(200);
      const fuj = adminEmirateListSchema.parse(res.body).items.find((e) => e.code === 'FUJ');
      expect(fuj).toMatchObject({ enabled: false, branches: expect.any(Number) });
      expect(fuj!.branches).toBeGreaterThanOrEqual(1);

      const venue = await h.http().get(`/v1/venues/${v.businessId}`).expect(200);
      expect(venue.body.branches).toEqual([]);
      const hold = await holdRequest(h, customer, {
        branchId: v.branchId,
        serviceId: v.serviceId,
        startAt: dubaiDay(h, 2).at('11:00'),
      });
      expect(hold.status).toBe(422);
      expect(hold.body.error.code).toBe('EMIRATE_NOT_AVAILABLE');
      // No new deliveries to an address already saved there.
      const quote = await h
        .http()
        .post('/v1/checkout/quote')
        .set('Authorization', bearer(customer))
        .send({ addressId: fujAddress.body.id })
        .expect(422);
      expect(quote.body.error.code).toBe('EMIRATE_NOT_AVAILABLE');
      await h
        .http()
        .patch('/v1/admin/operations/emirates/XX')
        .set('Authorization', ops)
        .send({ enabled: true })
        .expect(400);
      const audit = await h.db
        .selectFrom('audit_logs')
        .select('action')
        .where('action', '=', 'emirate.disabled')
        .execute();
      expect(audit.length).toBeGreaterThanOrEqual(1);
    } finally {
      await h.db.updateTable('emirates').set({ enabled: true }).where('code', '=', 'FUJ').execute();
    }
    const again = await holdRequest(h, customer, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 2).at('11:00'),
    });
    expect(again.status).toBe(201);
  });
});

describe('addresses', () => {
  it('makes the first address the default and keeps one default', async () => {
    const session = await signUp(h);
    const first = await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', bearer(session))
      .send(address)
      .expect(201);
    expect(addressSchema.parse(first.body).isDefault).toBe(true);
    const second = await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', bearer(session))
      .send({ ...address, emirate: 'AUH', isDefault: true, latitude: 24.4539, longitude: 54.3773 })
      .expect(201);
    expect(second.body).toMatchObject({ isDefault: true, latitude: 24.4539, longitude: 54.3773 });
    const list = await h
      .http()
      .get('/v1/me/addresses')
      .set('Authorization', bearer(session))
      .expect(200);
    const page = pageSchema(addressSchema).parse(list.body);
    expect(page.items.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.body.id]);
  });

  it('paginates with a cursor', async () => {
    const session = await signUp(h);
    for (let i = 0; i < 3; i++) {
      await h
        .http()
        .post('/v1/me/addresses')
        .set('Authorization', bearer(session))
        .send({ ...address, building: `Tower ${i}` })
        .expect(201);
    }
    const one = await h
      .http()
      .get('/v1/me/addresses?limit=2')
      .set('Authorization', bearer(session))
      .expect(200);
    expect(one.body.items).toHaveLength(2);
    const two = await h
      .http()
      .get(`/v1/me/addresses?limit=2&cursor=${one.body.nextCursor}`)
      .set('Authorization', bearer(session))
      .expect(200);
    expect(two.body.items).toHaveLength(1);
    expect(two.body.nextCursor).toBeNull();
    expect(
      new Set([...one.body.items, ...two.body.items].map((a: { id: string }) => a.id)).size,
    ).toBe(3);
    await h
      .http()
      .get('/v1/me/addresses?cursor=garbage')
      .set('Authorization', bearer(session))
      .expect(400);
  });

  it("never exposes or changes another customer's address (IDOR)", async () => {
    const alice = await signUp(h);
    const bob = await signUp(h);
    const created = await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', bearer(alice))
      .send(address)
      .expect(201);
    const path = `/v1/me/addresses/${created.body.id}`;
    await h.http().get(path).set('Authorization', bearer(bob)).expect(404);
    await h
      .http()
      .patch(path)
      .set('Authorization', bearer(bob))
      .send({ area: 'Hijacked' })
      .expect(404);
    await h.http().delete(path).set('Authorization', bearer(bob)).expect(404);
    const list = await h
      .http()
      .get('/v1/me/addresses')
      .set('Authorization', bearer(bob))
      .expect(200);
    expect(list.body.items).toEqual([]);
    const still = await h.http().get(path).set('Authorization', bearer(alice)).expect(200);
    expect(still.body.area).toBe(address.area);
  });

  it('archives instead of deleting, and validates coordinates', async () => {
    const session = await signUp(h);
    const created = await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', bearer(session))
      .send(address)
      .expect(201);
    await h
      .http()
      .delete(`/v1/me/addresses/${created.body.id}`)
      .set('Authorization', bearer(session))
      .expect(204);
    await h
      .http()
      .get(`/v1/me/addresses/${created.body.id}`)
      .set('Authorization', bearer(session))
      .expect(404);
    const row = await h.db
      .selectFrom('addresses')
      .select('archived_at')
      .where('id', '=', created.body.id)
      .executeTakeFirstOrThrow();
    expect(row.archived_at).not.toBeNull();
    await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', bearer(session))
      .send({ ...address, latitude: 25 })
      .expect(400);
  });
});
