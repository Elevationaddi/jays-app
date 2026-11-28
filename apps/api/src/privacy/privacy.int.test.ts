import { consentRecordSchema, dataExportSchema, pageSchema, privacySchema } from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createBusiness,
  type Harness,
  lastCode,
  PASSWORD,
  signUp,
  startHarness,
  uniqueEmail,
} from '../testing/harness.js';
import { PrivacyService } from './privacy.service.js';

let h: Harness;
let privacy: PrivacyService;
beforeAll(async () => {
  h = await startHarness();
  privacy = h.app.get(PrivacyService);
});
afterAll(async () => {
  await h.close();
});

const DAY = 24 * 3600;

describe('marketing consent (D15)', () => {
  it('records per-channel consent given at sign-up, separately from the terms', async () => {
    const email = uniqueEmail();
    const reg = await h
      .http()
      .post('/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        acceptTerms: true,
        locale: 'ar',
        marketing: { email: true },
      })
      .expect(202);
    const verified = await h
      .http()
      .post('/v1/auth/verify')
      .send({ challengeId: reg.body.challengeId, code: lastCode(h, email) })
      .expect(200);
    const token = `Bearer ${verified.body.tokens.accessToken}`;
    expect(verified.body.user.marketing).toEqual({ email: true, sms: false, push: false });
    const res = await h.http().get('/v1/me/consents').set('Authorization', token).expect(200);
    const page = pageSchema(consentRecordSchema).parse(res.body);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      purpose: 'marketing_email',
      granted: true,
      source: 'signup',
      locale: 'ar',
      policyVersion: 'draft-2026-11',
    });
  });

  it('defaults to no marketing and keeps the full grant and withdrawal history', async () => {
    const s = await signUp(h);
    const auth = bearer(s);
    let res = await h.http().get('/v1/me/privacy').set('Authorization', auth).expect(200);
    expect(privacySchema.parse(res.body)).toMatchObject({
      marketing: { email: false, sms: false, push: false },
      notifications: { email: true, sms: true, push: true },
      deletion: null,
    });

    await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', auth)
      .send({ marketing: { sms: true, push: true }, locale: 'ar' })
      .expect(200);
    // Repeating a choice records nothing new.
    await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', auth)
      .send({ marketing: { sms: true } })
      .expect(200);
    res = await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', auth)
      .send({ marketing: { sms: false } })
      .expect(200);
    expect(res.body.marketing).toEqual({ email: false, sms: false, push: true });

    res = await h.http().get('/v1/me/consents').set('Authorization', auth).expect(200);
    const history = pageSchema(consentRecordSchema).parse(res.body).items;
    expect(history.map((r) => [r.purpose, r.granted, r.source, r.locale])).toEqual([
      ['marketing_sms', false, 'settings', 'en'],
      expect.anything(),
      expect.anything(),
    ]);
    expect(
      history
        .slice(1)
        .map((r) => `${r.purpose}:${r.granted}:${r.locale}`)
        .sort(),
    ).toEqual(['marketing_push:true:ar', 'marketing_sms:true:ar']);

    // History cannot be rewritten.
    await expect(
      h.db.deleteFrom('consent_records').where('user_id', '=', s.user.id).execute(),
    ).rejects.toThrow();
  });

  it('rejects an empty change', async () => {
    const s = await signUp(h);
    await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', bearer(s))
      .send({ locale: 'en' })
      .expect(400);
    await h.http().get('/v1/me/privacy').expect(401);
  });
});

describe('notification preferences (D14)', () => {
  it('stores transactional channel preferences separately from marketing', async () => {
    const s = await signUp(h);
    await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', bearer(s))
      .send({ notifications: { email: false } })
      .expect(200);
    const row = await h.db
      .selectFrom('users')
      .select(['notify_email', 'notify_sms'])
      .where('id', '=', s.user.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ notify_email: false, notify_sms: true });
  });
});

describe('one-click unsubscribe', () => {
  it('withdraws marketing with a signed link, without signing in', async () => {
    const s = await signUp(h);
    await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', bearer(s))
      .send({ marketing: { email: true, sms: true } })
      .expect(200);
    const token = privacy.unsubscribeToken(s.user.id, 'email');
    const preview = await h.http().get('/v1/unsubscribe').query({ token }).expect(200);
    expect(preview.body).toEqual({ channel: 'email', done: false });
    let res = await h.http().get('/v1/me/privacy').set('Authorization', bearer(s)).expect(200);
    expect(res.body.marketing.email).toBe(true);

    await h
      .http()
      .post('/v1/unsubscribe')
      .query({ token })
      .expect(200, { channel: 'email', done: true });
    // A second click is harmless.
    await h.http().post('/v1/unsubscribe').query({ token }).expect(200);
    res = await h.http().get('/v1/me/privacy').set('Authorization', bearer(s)).expect(200);
    expect(res.body.marketing).toEqual({ email: false, sms: true, push: false });

    const records = await h.db
      .selectFrom('consent_records')
      .select(['purpose', 'granted', 'source'])
      .where('user_id', '=', s.user.id)
      .where('source', '=', 'unsubscribe_link')
      .execute();
    expect(records).toEqual([
      { purpose: 'marketing_email', granted: false, source: 'unsubscribe_link' },
    ]);
  });

  it('refuses forged or garbled links', async () => {
    const s = await signUp(h);
    const token = privacy.unsubscribeToken(s.user.id, 'all');
    const res = await h
      .http()
      .post('/v1/unsubscribe')
      .query({ token: `${token.slice(0, -2)}xx` })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_UNSUBSCRIBE_LINK');
    await h.http().post('/v1/unsubscribe').expect(400);
  });
});

describe('data export', () => {
  it('returns the person’s own data and nobody else’s', async () => {
    const a = await signUp(h);
    const b = await signUp(h);
    await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', bearer(b))
      .send({ emirate: 'AUH', area: 'Fictional Area', street: 'Example 2', building: 'B' })
      .expect(201);
    const res = await h.http().get('/v1/me/export').set('Authorization', bearer(a)).expect(200);
    const data = dataExportSchema.parse(res.body);
    expect(data.profile['email']).toBe(a.email);
    expect(data.addresses).toEqual([]);
  });
});

describe('account deletion', () => {
  it('needs the password, can be canceled, and anonymises after the grace period', async () => {
    const s = await signUp(h);
    const auth = bearer(s);
    await h
      .http()
      .patch('/v1/me/privacy')
      .set('Authorization', auth)
      .send({ marketing: { email: true } })
      .expect(200);
    await h
      .http()
      .post('/v1/me/addresses')
      .set('Authorization', auth)
      .send({ emirate: 'AUH', area: 'Fictional Area', street: 'Example 3', building: 'C' })
      .expect(201);

    let res = await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', auth)
      .send({ password: 'wrong password 123' })
      .expect(422);
    expect(res.body.error.code).toBe('PASSWORD_INCORRECT');

    res = await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', auth)
      .send({ password: PASSWORD, reason: 'Testing' })
      .expect(200);
    const scheduled = privacySchema.parse(res.body).deletion;
    expect(scheduled?.status).toBe('pending');
    const graceMs = new Date(scheduled!.scheduledFor).getTime() - h.clock.now().getTime();
    expect(Math.abs(graceMs - 14 * DAY * 1000)).toBeLessThan(60_000);
    res = await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', auth)
      .send({ password: PASSWORD })
      .expect(409);
    expect(res.body.error.code).toBe('DELETION_PENDING');

    // Changing your mind keeps the account.
    res = await h.http().delete('/v1/me/deletion').set('Authorization', auth).expect(200);
    expect(res.body.deletion).toBeNull();
    await h.http().delete('/v1/me/deletion').set('Authorization', auth).expect(404);

    await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', auth)
      .send({ password: PASSWORD })
      .expect(200);
    const status = async () =>
      (
        await h.db
          .selectFrom('users')
          .select('status')
          .where('id', '=', s.user.id)
          .executeTakeFirstOrThrow()
      ).status;
    // Not due yet.
    h.clock.advance(13 * DAY);
    await privacy.completeDueDeletions();
    expect(await status()).toBe('active');
    h.clock.advance(1 * DAY + 60);
    expect(await privacy.completeDueDeletions()).toBeGreaterThanOrEqual(1);
    expect(await status()).toBe('deactivated');

    const user = await h.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', s.user.id)
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({
      email: `deleted-${s.user.id}@deleted.invalid`,
      phone: null,
      status: 'deactivated',
      display_name: null,
      marketing_email: false,
      notify_email: false,
    });
    expect(user.deleted_at).not.toBeNull();
    const addresses = await h.db
      .selectFrom('addresses')
      .select(['street', 'archived_at'])
      .where('user_id', '=', s.user.id)
      .execute();
    expect(addresses).toEqual([{ street: 'deleted', archived_at: expect.any(Date) }]);
    const withdrawn = await h.db
      .selectFrom('consent_records')
      .select(['purpose', 'granted'])
      .where('user_id', '=', s.user.id)
      .where('source', '=', 'account_deletion')
      .execute();
    expect(withdrawn).toEqual([{ purpose: 'marketing_email', granted: false }]);

    // The old credentials no longer work, the sessions are gone, and the address is free again.
    await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: s.email, password: PASSWORD })
      .expect(401);
    await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: s.tokens.refreshToken })
      .expect(401);
    const again = await signUp(h, s.email);
    expect(again.user.id).not.toBe(s.user.id);
  });

  it('is refused while the person is still a member of a business', async () => {
    const s = await signUp(h);
    await createBusiness(h, s);
    const res = await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', bearer(s))
      .send({ password: PASSWORD })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'ACCOUNT_HAS_OPEN_ACTIVITY',
      fieldErrors: { reason: ['business_member'] },
    });
  });

  it('is postponed when activity starts during the grace period', async () => {
    const s = await signUp(h);
    await h
      .http()
      .post('/v1/me/deletion')
      .set('Authorization', bearer(s))
      .send({ password: PASSWORD })
      .expect(200);
    await createBusiness(h, s);
    h.clock.advance(15 * DAY);
    await privacy.completeDueDeletions();
    const request = await h.db
      .selectFrom('account_deletion_requests')
      .select(['status', 'postponed_reason'])
      .where('user_id', '=', s.user.id)
      .executeTakeFirstOrThrow();
    expect(request).toEqual({ status: 'pending', postponed_reason: 'business_member' });
  });
});
