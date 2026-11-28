import {
  businessSchema,
  errorEnvelopeSchema,
  memberSchema,
  myMembershipSchema,
  pageSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, type Harness, PASSWORD, signUp, startHarness } from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const name = { en: 'Fictional Oud & Bloom', ar: 'عود وبلوم التجريبي' };

async function createBusiness(session: Awaited<ReturnType<typeof signUp>>, modes = ['shop']) {
  const res = await h
    .http()
    .post('/v1/businesses')
    .set('Authorization', bearer(session))
    .send({ displayName: name, modes })
    .expect(201);
  return businessSchema.parse(res.body);
}

/** Invites `invitee` with permissions and has them accept. Returns the membership id. */
async function addMember(
  owner: Awaited<ReturnType<typeof signUp>>,
  businessId: string,
  invitee: Awaited<ReturnType<typeof signUp>>,
  permissions: string[],
) {
  const invite = await h
    .http()
    .post(`/v1/businesses/${businessId}/members`)
    .set('Authorization', bearer(owner))
    .send({ identifier: invitee.email, permissions })
    .expect(201);
  await h
    .http()
    .post(`/v1/me/memberships/${invite.body.id}/accept`)
    .set('Authorization', bearer(invitee))
    .expect(200);
  return invite.body.id as string;
}

describe('business gateway', () => {
  it('creates a draft business with the creator as owner and onboarding modes', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(owner, ['services']);
    expect(business).toMatchObject({
      status: 'draft',
      modes: { shop: 'not_activated', services: 'onboarding' },
      myPermissions: ['owner'],
    });
    expect(business.myCapabilities).toContain('payouts.manage');

    const list = await h
      .http()
      .get('/v1/me/memberships')
      .set('Authorization', bearer(owner))
      .expect(200);
    const page = pageSchema(myMembershipSchema).parse(list.body);
    expect(page.items.map((m) => m.business.id)).toEqual([business.id]);
    const me = await h.http().get('/v1/me').set('Authorization', bearer(owner)).expect(200);
    expect(me.body.hasBusinessMembership).toBe(true);
  });

  it('lets a hybrid owner activate the second mode without losing the first (idempotent)', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(owner, ['shop']);
    const first = await h
      .http()
      .post(`/v1/businesses/${business.id}/modes/services/activate`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(first.body.modes).toEqual({ shop: 'onboarding', services: 'onboarding' });
    const again = await h
      .http()
      .post(`/v1/businesses/${business.id}/modes/services/activate`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(again.body.modes).toEqual(first.body.modes);
    await h
      .http()
      .post(`/v1/businesses/${business.id}/modes/admin/activate`)
      .set('Authorization', bearer(owner))
      .expect(400);
  });

  it('never lets a client self-approve or pick status/owner fields', async () => {
    const owner = await signUp(h);
    const res = await h
      .http()
      .post('/v1/businesses')
      .set('Authorization', bearer(owner))
      .send({ displayName: name, modes: ['shop'], status: 'approved' })
      .expect(400);
    expect(errorEnvelopeSchema.parse(res.body).error.fieldErrors).toBeDefined();
    await h
      .http()
      .post('/v1/businesses')
      .set('Authorization', bearer(owner))
      .send({ displayName: { en: 'Only English' }, modes: ['shop'] })
      .expect(400);
  });
});

describe('tenant isolation and permissions (T03)', () => {
  it('hides business A from a member of business B (404, not 403)', async () => {
    const ownerA = await signUp(h);
    const ownerB = await signUp(h);
    const a = await createBusiness(ownerA);
    await createBusiness(ownerB);
    for (const path of [`/v1/businesses/${a.id}`, `/v1/businesses/${a.id}/members`]) {
      const res = await h.http().get(path).set('Authorization', bearer(ownerB)).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    await h
      .http()
      .post(`/v1/businesses/${a.id}/modes/services/activate`)
      .set('Authorization', bearer(ownerB))
      .expect(404);
    await h.http().get(`/v1/businesses/${a.id}`).expect(401);
    await h
      .http()
      .get('/v1/businesses/not-a-uuid')
      .set('Authorization', bearer(ownerB))
      .expect(404);
  });

  it('gives an invitee no access until they accept', async () => {
    const owner = await signUp(h);
    const staff = await signUp(h);
    const business = await createBusiness(owner);
    const invite = await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(owner))
      .send({ identifier: staff.email, permissions: ['scheduler'] })
      .expect(201);
    expect(memberSchema.parse(invite.body)).toMatchObject({
      status: 'invited',
      permissions: ['scheduler'],
    });
    expect(invite.body.contact).toMatch(/\*\*\*@example\.test$/);
    await h
      .http()
      .get(`/v1/businesses/${business.id}`)
      .set('Authorization', bearer(staff))
      .expect(404);
    const pending = await h
      .http()
      .get('/v1/me/memberships')
      .set('Authorization', bearer(staff))
      .expect(200);
    expect(pending.body.items[0]).toMatchObject({
      status: 'invited',
      business: { id: business.id, myCapabilities: [] },
    });
    // Only the invitee can accept.
    await h
      .http()
      .post(`/v1/me/memberships/${invite.body.id}/accept`)
      .set('Authorization', bearer(owner))
      .expect(404);
    await h
      .http()
      .post(`/v1/me/memberships/${invite.body.id}/accept`)
      .set('Authorization', bearer(staff))
      .expect(200);
    const view = await h
      .http()
      .get(`/v1/businesses/${business.id}`)
      .set('Authorization', bearer(staff))
      .expect(200);
    expect(view.body.myCapabilities).toEqual([
      'business.view',
      'bookings.schedule',
      'appointments.view_all',
    ]);
    const outbox = await h.db
      .selectFrom('outbox')
      .select('event_type')
      .where('payload', '@>', JSON.stringify({ membershipId: invite.body.id }) as never)
      .execute();
    expect(outbox.map((o) => o.event_type)).toEqual(['business.member_invited']);
  });

  it('enforces capabilities: staff cannot manage the team, change modes or touch payouts', async () => {
    const owner = await signUp(h);
    const finance = await signUp(h);
    const scheduler = await signUp(h);
    const outsider = await signUp(h);
    const business = await createBusiness(owner);
    await addMember(owner, business.id, finance, ['finance']);
    await addMember(owner, business.id, scheduler, ['scheduler']);
    const view = await h
      .http()
      .get(`/v1/businesses/${business.id}`)
      .set('Authorization', bearer(finance))
      .expect(200);
    expect(view.body.myCapabilities).toEqual(['business.view', 'finance.view', 'dashboard.view']);
    expect(view.body.myCapabilities).not.toContain('payouts.manage');
    await h
      .http()
      .get(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(scheduler))
      .expect(403);
    await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(scheduler))
      .send({ identifier: outsider.email, permissions: ['professional'] })
      .expect(403);
    await h
      .http()
      .post(`/v1/businesses/${business.id}/modes/services/activate`)
      .set('Authorization', bearer(finance))
      .expect(403);
  });

  it('limits managers to operational permissions and protects the last owner', async () => {
    const owner = await signUp(h);
    const manager = await signUp(h);
    const newcomer = await signUp(h);
    const business = await createBusiness(owner);
    await addMember(owner, business.id, manager, ['manager']);
    const escalate = await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(manager))
      .send({ identifier: newcomer.email, permissions: ['owner'] })
      .expect(403);
    expect(escalate.body.error.code).toBe('FORBIDDEN');
    await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(manager))
      .send({ identifier: newcomer.email, permissions: ['superadmin'] })
      .expect(400);
    const ok = await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(manager))
      .send({ identifier: newcomer.email, permissions: ['professional'] })
      .expect(201);
    await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(manager))
      .send({ identifier: newcomer.email, permissions: ['scheduler'] })
      .expect(409);

    const members = await h
      .http()
      .get(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const ownerMembership = members.body.items.find((m: { permissions: string[] }) =>
      m.permissions.includes('owner'),
    );
    // Manager cannot touch the owner; the owner cannot remove or demote themselves while sole owner.
    await h
      .http()
      .delete(`/v1/businesses/${business.id}/members/${ownerMembership.id}`)
      .set('Authorization', bearer(manager))
      .expect(403);
    const last = await h
      .http()
      .delete(`/v1/businesses/${business.id}/members/${ownerMembership.id}`)
      .set('Authorization', bearer(owner))
      .expect(409);
    expect(last.body.error.code).toBe('LAST_OWNER');
    await h
      .http()
      .patch(`/v1/businesses/${business.id}/members/${ownerMembership.id}`)
      .set('Authorization', bearer(owner))
      .send({ permissions: ['manager'] })
      .expect(409);
    // Manager can cancel the invitation they created.
    await h
      .http()
      .delete(`/v1/businesses/${business.id}/members/${ok.body.id}`)
      .set('Authorization', bearer(manager))
      .expect(204);

    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('business_id', '=', business.id)
      .orderBy('created_at')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'business.created',
        'membership.invited',
        'membership.accepted',
        'membership.removed',
      ]),
    );
  });

  it('cuts access as soon as a member is removed', async () => {
    const owner = await signUp(h);
    const staff = await signUp(h);
    const business = await createBusiness(owner);
    const membershipId = await addMember(owner, business.id, staff, ['fulfillment']);
    await h
      .http()
      .get(`/v1/businesses/${business.id}`)
      .set('Authorization', bearer(staff))
      .expect(200);
    await h
      .http()
      .delete(`/v1/businesses/${business.id}/members/${membershipId}`)
      .set('Authorization', bearer(owner))
      .expect(204);
    await h
      .http()
      .get(`/v1/businesses/${business.id}`)
      .set('Authorization', bearer(staff))
      .expect(404);
  });

  it('lets a member leave (then delete their account) but never the last owner (ADR-0039)', async () => {
    const owner = await signUp(h);
    const staff = await signUp(h);
    const business = await createBusiness(owner);
    const membershipId = await addMember(owner, business.id, staff, ['fulfillment']);
    // Deleting the account is blocked while the membership is active.
    await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', bearer(staff))
      .send({ password: PASSWORD })
      .expect(409);
    // Nobody can leave on someone else's behalf.
    await h
      .http()
      .post(`/v1/me/memberships/${membershipId}/leave`)
      .set('Authorization', bearer(owner))
      .expect(404);
    await h
      .http()
      .post(`/v1/me/memberships/${membershipId}/leave`)
      .set('Authorization', bearer(staff))
      .expect(204);
    await h
      .http()
      .get(`/v1/businesses/${business.id}`)
      .set('Authorization', bearer(staff))
      .expect(404);
    await h
      .http()
      .post(`/v1/me/memberships/${membershipId}/leave`)
      .set('Authorization', bearer(staff))
      .expect(404);
    await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', bearer(staff))
      .send({ password: PASSWORD })
      .expect(200);

    const mine = await h
      .http()
      .get('/v1/me/memberships')
      .set('Authorization', bearer(owner))
      .expect(200);
    const ownerMembership = mine.body.items.find(
      (m: { business: { id: string } }) => m.business.id === business.id,
    ).membershipId as string;
    const res = await h
      .http()
      .post(`/v1/me/memberships/${ownerMembership}/leave`)
      .set('Authorization', bearer(owner))
      .expect(409);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  it('refuses to invite someone without a verified account', async () => {
    const owner = await signUp(h);
    const business = await createBusiness(owner);
    const res = await h
      .http()
      .post(`/v1/businesses/${business.id}/members`)
      .set('Authorization', bearer(owner))
      .send({ identifier: 'nobody-here@example.test', permissions: ['scheduler'] })
      .expect(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});
