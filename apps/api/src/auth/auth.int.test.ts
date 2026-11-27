import {
  challengeSchema,
  errorEnvelopeSchema,
  sessionSchema,
  tokenPairSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  type Harness,
  lastCode,
  PASSWORD,
  signUp,
  startHarness,
  uniqueEmail,
  uniquePhone,
  otherPassword,
} from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe('register and verify', () => {
  it('creates an unverified account, verifies it with the code and signs in', async () => {
    const email = uniqueEmail();
    const reg = await h
      .http()
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, acceptTerms: true, locale: 'ar' })
      .expect(202);
    const challenge = challengeSchema.parse(reg.body);
    expect(challenge.destination).toMatch(/^u\*\*\*@example\.test$/);
    const user = await h.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(user.status).toBe('pending_verification');
    expect(user.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(user.terms_version).toBe('draft-2026-11');

    const res = await h
      .http()
      .post('/v1/auth/verify')
      .send({ challengeId: challenge.challengeId, code: lastCode(h, email) })
      .expect(200);
    const session = sessionSchema.parse(res.body);
    expect(session.user).toMatchObject({
      email,
      emailVerified: true,
      status: 'active',
      locale: 'ar',
      hasBusinessMembership: false,
    });
    const me = await h.http().get('/v1/me').set('Authorization', bearer(session)).expect(200);
    expect(me.body.id).toBe(session.user.id);
  });

  it('works with a phone number', async () => {
    const phone = uniquePhone();
    const reg = await h
      .http()
      .post('/v1/auth/register')
      .send({ phone, password: PASSWORD, acceptTerms: true })
      .expect(202);
    expect(reg.body.channel).toBe('sms');
    const res = await h
      .http()
      .post('/v1/auth/verify')
      .send({ challengeId: reg.body.challengeId, code: lastCode(h, phone) })
      .expect(200);
    expect(res.body.user).toMatchObject({ phone, phoneVerified: true });
  });

  it('rejects role claims and other unknown fields (no role escalation)', async () => {
    for (const extra of [{ role: 'admin' }, { permissions: ['owner'] }, { status: 'active' }]) {
      const res = await h
        .http()
        .post('/v1/auth/register')
        .send({ email: uniqueEmail(), password: PASSWORD, acceptTerms: true, ...extra })
        .expect(400);
      expect(errorEnvelopeSchema.parse(res.body).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('requires terms, one contact and a long enough password', async () => {
    const res = await h
      .http()
      .post('/v1/auth/register')
      .send({ email: uniqueEmail(), phone: uniquePhone(), password: 'short' })
      .expect(400);
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(
      expect.arrayContaining(['password', 'acceptTerms']),
    );
  });

  it('answers identically for an existing contact and the decoy can never verify', async () => {
    const { email } = await signUp(h);
    const reg = await h
      .http()
      .post('/v1/auth/register')
      .send({ email, password: otherPassword('Another'), acceptTerms: true })
      .expect(202);
    expect(Object.keys(reg.body).sort()).toEqual([
      'challengeId',
      'channel',
      'destination',
      'expiresAt',
      'resendAvailableAt',
    ]);
    expect(h.notifier.lastTo(email)?.template).toBe('account.exists');
    for (const code of ['000000', '123456']) {
      await h
        .http()
        .post('/v1/auth/verify')
        .send({ challengeId: reg.body.challengeId, code })
        .expect(400);
    }
    // The original password still works; the second registration changed nothing.
    const login = await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(200);
    expect(login.body.status).toBe('authenticated');
  });
});

describe('one-time code rules', () => {
  it('rejects an expired code', async () => {
    const email = uniqueEmail();
    const reg = await h
      .http()
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, acceptTerms: true })
      .expect(202);
    const code = lastCode(h, email);
    h.clock.advance(10 * 60 + 1);
    try {
      const res = await h
        .http()
        .post('/v1/auth/verify')
        .send({ challengeId: reg.body.challengeId, code })
        .expect(400);
      expect(res.body.error.code).toBe('OTP_EXPIRED');
    } finally {
      h.clock.advance(-(10 * 60 + 1));
    }
  });

  it('locks the code after five wrong attempts, even if the right code follows', async () => {
    const email = uniqueEmail();
    const reg = await h
      .http()
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, acceptTerms: true })
      .expect(202);
    const code = lastCode(h, email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await h
        .http()
        .post('/v1/auth/verify')
        .send({ challengeId: reg.body.challengeId, code: wrong })
        .expect(400);
      expect(res.body.error.code).toBe('OTP_INVALID');
    }
    const locked = await h
      .http()
      .post('/v1/auth/verify')
      .send({ challengeId: reg.body.challengeId, code })
      .expect(429);
    expect(locked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('enforces the resend cooldown and invalidates the previous code', async () => {
    const email = uniqueEmail();
    const reg = await h
      .http()
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, acceptTerms: true })
      .expect(202);
    const first = lastCode(h, email);
    const early = await h
      .http()
      .post('/v1/auth/verify/resend')
      .send({ challengeId: reg.body.challengeId })
      .expect(429);
    expect(early.body.error.code).toBe('OTP_RESEND_COOLDOWN');
    expect(Number(early.headers['retry-after'])).toBeGreaterThan(0);
    h.clock.advance(61);
    try {
      await h
        .http()
        .post('/v1/auth/verify/resend')
        .send({ challengeId: reg.body.challengeId })
        .expect(200);
    } finally {
      h.clock.advance(-61);
    }
    const second = lastCode(h, email);
    if (first !== second) {
      await h
        .http()
        .post('/v1/auth/verify')
        .send({ challengeId: reg.body.challengeId, code: first })
        .expect(400);
    }
    await h
      .http()
      .post('/v1/auth/verify')
      .send({ challengeId: reg.body.challengeId, code: second })
      .expect(200);
  });

  it('rate limits code sends to one destination', async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await h.http().post('/v1/auth/password/reset-request').send({ identifier: email })).status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses[5]).toBe(429);
  });
});

describe('login', () => {
  it('rejects a wrong password and an unknown account the same way', async () => {
    const { email } = await signUp(h);
    const wrong = await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: email, password: otherPassword('Wrong') })
      .expect(401);
    const unknown = await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: uniqueEmail(), password: otherPassword('Wrong') })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('rate limits repeated attempts on one account', async () => {
    const { email } = await signUp(h);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await h
            .http()
            .post('/v1/auth/login')
            .send({ identifier: email, password: otherPassword('Wrong') })
        ).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const blocked = await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('asks an unverified account to verify instead of issuing tokens', async () => {
    const email = uniqueEmail();
    await h
      .http()
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, acceptTerms: true })
      .expect(202);
    const res = await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: email.toUpperCase(), password: PASSWORD })
      .expect(200);
    expect(res.body.status).toBe('verification_required');
    expect(res.body.tokens).toBeUndefined();
    await h
      .http()
      .post('/v1/auth/verify')
      .send({ challengeId: res.body.challenge.challengeId, code: lastCode(h, email) })
      .expect(200);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and ends the session when an old one is reused', async () => {
    const session = await signUp(h);
    const first = await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.tokens.refreshToken })
      .expect(200);
    const rotated = tokenPairSchema.parse(first.body);
    expect(rotated.refreshToken).not.toBe(session.tokens.refreshToken);

    const reuse = await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.tokens.refreshToken })
      .expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    // The legitimate newer token is dead too, and so is the access token for that session.
    const after = await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.refreshToken })
      .expect(401);
    expect(after.body.error.code).toBe('SESSION_REVOKED');
    await h.http().get('/v1/me').set('Authorization', `Bearer ${rotated.accessToken}`).expect(401);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', session.user.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('session.refresh_reuse_detected');
  });

  it('lets only one of two concurrent refreshes with the same token succeed', async () => {
    const session = await signUp(h);
    const results = await Promise.all([
      h.http().post('/v1/auth/refresh').send({ refreshToken: session.tokens.refreshToken }),
      h.http().post('/v1/auth/refresh').send({ refreshToken: session.tokens.refreshToken }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('logs out: the access token stops working at once and logout is idempotent', async () => {
    const session = await signUp(h);
    await h
      .http()
      .post('/v1/auth/logout')
      .send({ refreshToken: session.tokens.refreshToken })
      .expect(204);
    await h
      .http()
      .post('/v1/auth/logout')
      .send({ refreshToken: session.tokens.refreshToken })
      .expect(204);
    await h.http().get('/v1/me').set('Authorization', bearer(session)).expect(401);
    await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.tokens.refreshToken })
      .expect(401);
  });

  it('expires access tokens after 15 minutes and sessions after 30 idle days', async () => {
    const session = await signUp(h);
    h.clock.advance(15 * 60 + 1);
    try {
      await h.http().get('/v1/me').set('Authorization', bearer(session)).expect(401);
      const refreshed = await h
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: session.tokens.refreshToken })
        .expect(200);
      h.clock.advance(30 * 24 * 3600);
      const expired = await h
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: refreshed.body.refreshToken })
        .expect(401);
      expect(expired.body.error.code).toBe('SESSION_EXPIRED');
      h.clock.advance(-30 * 24 * 3600);
    } finally {
      h.clock.advance(-(15 * 60 + 1));
    }
  });

  it('refuses malformed and forged tokens', async () => {
    await h.http().get('/v1/me').expect(401);
    await h.http().get('/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'x'.repeat(40) })
      .expect(401);
    await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: `00000000-0000-4000-8000-000000000000.${'y'.repeat(43)}` })
      .expect(401);
  });
});

describe('password reset', () => {
  it('sets a new password, ends existing sessions and signs in', async () => {
    const session = await signUp(h);
    const req = await h
      .http()
      .post('/v1/auth/password/reset-request')
      .send({ identifier: session.email })
      .expect(202);
    expect(h.notifier.lastTo(session.email)?.template).toBe('otp.password_reset');
    const newPassword = otherPassword('Brand-New');
    const res = await h
      .http()
      .post('/v1/auth/password/reset')
      .send({ challengeId: req.body.challengeId, code: lastCode(h, session.email), newPassword })
      .expect(200);
    sessionSchema.parse(res.body);
    await h.http().get('/v1/me').set('Authorization', bearer(session)).expect(401);
    await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: session.email, password: PASSWORD })
      .expect(401);
    await h
      .http()
      .post('/v1/auth/login')
      .send({ identifier: session.email, password: newPassword })
      .expect(200);
  });

  it('answers the same for an unknown account without sending anything', async () => {
    const email = uniqueEmail();
    const res = await h
      .http()
      .post('/v1/auth/password/reset-request')
      .send({ identifier: email })
      .expect(202);
    challengeSchema.parse(res.body);
    expect(h.notifier.lastTo(email)).toBeUndefined();
  });
});

describe('per-IP limits', () => {
  it('limits registrations from one client IP', async () => {
    const ip = '192.0.2.77';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (
          await h
            .http(ip)
            .post('/v1/auth/register')
            .send({ email: uniqueEmail(), password: PASSWORD, acceptTerms: true })
        ).status,
      );
    }
    expect(statuses.filter((s) => s === 202)).toHaveLength(10);
    expect(statuses[10]).toBe(429);
  });
});
