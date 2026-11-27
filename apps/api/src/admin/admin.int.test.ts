import {
  adminSessionSchema,
  auditLogItemSchema,
  mfaEnrollmentSchema,
  pageSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, SecretBox } from '../auth/crypto.js';
import { generateTotpSecret, totpAt } from '../auth/totp.js';
import { testEnv } from '../testing/test-env.js';
import {
  bearer,
  type Harness,
  PASSWORD,
  signUp,
  startHarness,
  uniqueEmail,
  otherPassword,
} from '../testing/harness.js';

let h: Harness;
const box = new SecretBox(testEnv().MFA_ENCRYPTION_KEY);

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

/** Provisions an active admin directly (as the seed and bootstrap do) and returns its TOTP secret. */
async function provisionAdmin(roles: string[]) {
  const email = uniqueEmail('admin');
  const secret = generateTotpSecret();
  const admin = await h.db
    .insertInto('admin_accounts')
    .values({
      email,
      display_name: 'Fictional Admin',
      password_hash: await hashPassword(PASSWORD),
      status: 'active',
      mfa_secret_enc: box.seal(secret),
      mfa_enabled_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.db
    .insertInto('admin_roles')
    .values(roles.map((role) => ({ admin_id: admin.id, role })))
    .execute();
  return { id: admin.id, email, secret };
}

/** A code for a step that has not been used yet (each step works once). */
function freshCode(secret: string) {
  h.clock.advance(30);
  return totpAt(secret, h.clock.now());
}

async function adminLogin(admin: { email: string; secret: string }) {
  const res = await h
    .http()
    .post('/v1/admin/auth/login')
    .send({ email: admin.email, password: PASSWORD, totpCode: freshCode(admin.secret) })
    .expect(200);
  return adminSessionSchema.parse(res.body);
}

describe('admin sign-in requires MFA (T03)', () => {
  it('signs in only with password and a valid authenticator code', async () => {
    const admin = await provisionAdmin(['support']);
    await h
      .http()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(400);
    await h
      .http()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: PASSWORD, totpCode: '000000' })
      .expect(401);
    await h
      .http()
      .post('/v1/admin/auth/login')
      .send({
        email: admin.email,
        password: otherPassword('Wrong'),
        totpCode: freshCode(admin.secret),
      })
      .expect(401);
    const session = await adminLogin(admin);
    expect(session.admin).toMatchObject({
      email: admin.email,
      roles: ['support'],
      // Support can read merchant records (phase 2), listings (phase 3) and bookings (phase 4) but
      // holds no admin or audit capability.
      capabilities: ['businesses.view', 'products.view', 'bookings.view'],
    });
    await h.http().get('/v1/admin/me').set('Authorization', bearer(session)).expect(200);
  });

  it('refuses to reuse an authenticator code', async () => {
    const admin = await provisionAdmin(['analyst']);
    const code = freshCode(admin.secret);
    await h
      .http()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: PASSWORD, totpCode: code })
      .expect(200);
    await h
      .http()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: PASSWORD, totpCode: code })
      .expect(401);
  });

  it('keeps user and admin tokens apart', async () => {
    const user = await signUp(h);
    await h.http().get('/v1/admin/me').set('Authorization', bearer(user)).expect(401);
    const admin = await adminLogin(await provisionAdmin(['superadmin']));
    await h.http().get('/v1/me').set('Authorization', bearer(admin)).expect(401);
    await h
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: admin.tokens.refreshToken })
      .expect(401);
  });

  it('enforces platform roles on every admin endpoint', async () => {
    const support = await adminLogin(await provisionAdmin(['support']));
    await h.http().get('/v1/admin/admins').set('Authorization', bearer(support)).expect(403);
    await h.http().get('/v1/admin/audit-logs').set('Authorization', bearer(support)).expect(403);
    const compliance = await adminLogin(await provisionAdmin(['compliance']));
    const audit = await h
      .http()
      .get('/v1/admin/audit-logs?limit=5')
      .set('Authorization', bearer(compliance))
      .expect(200);
    pageSchema(auditLogItemSchema).parse(audit.body);
    await h.http().get('/v1/admin/admins').set('Authorization', bearer(compliance)).expect(403);
  });

  it('rotates and revokes admin sessions', async () => {
    const session = await adminLogin(await provisionAdmin(['operations']));
    const rotated = await h
      .http()
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.tokens.refreshToken })
      .expect(200);
    await h
      .http()
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.tokens.refreshToken })
      .expect(401);
    await h
      .http()
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });
});

describe('admin invitations', () => {
  it('invites with a reason, enrols TOTP and activates only after a valid code', async () => {
    const superadmin = await adminLogin(await provisionAdmin(['superadmin']));
    const email = uniqueEmail('invitee');
    await h
      .http()
      .post('/v1/admin/admins/invites')
      .set('Authorization', bearer(superadmin))
      .send({ email, displayName: 'Fictional Catalog Lead', roles: ['catalog'] })
      .expect(400);
    const invite = await h
      .http()
      .post('/v1/admin/admins/invites')
      .set('Authorization', bearer(superadmin))
      .send({
        email,
        displayName: 'Fictional Catalog Lead',
        roles: ['catalog'],
        reason: 'Catalog review cover for pilot',
      })
      .expect(201);
    expect(invite.body).toMatchObject({ email, status: 'invited' });
    expect(JSON.stringify(invite.body)).not.toContain('token');

    const link = new URL(h.notifier.lastTo(email)?.params['link'] ?? '');
    const token = link.searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(20);

    // An invited admin cannot sign in before enrolment.
    await h
      .http()
      .post('/v1/admin/auth/login')
      .send({ email, password: PASSWORD, totpCode: '123456' })
      .expect(401);
    const enrol = await h
      .http()
      .post('/v1/admin/invites/accept')
      .send({ token, password: PASSWORD })
      .expect(200);
    const { secret, otpauthUri } = mfaEnrollmentSchema.parse(enrol.body);
    expect(otpauthUri).toContain('otpauth://totp/');
    await h
      .http()
      .post('/v1/admin/invites/confirm-mfa')
      .send({ token, totpCode: '000000' })
      .expect(400);
    const confirmed = await h
      .http()
      .post('/v1/admin/invites/confirm-mfa')
      .send({ token, totpCode: freshCode(secret) })
      .expect(200);
    expect(adminSessionSchema.parse(confirmed.body).admin.roles).toEqual(['catalog']);
    // The invitation link works once.
    await h.http().post('/v1/admin/invites/accept').send({ token, password: PASSWORD }).expect(400);

    const stored = await h.db
      .selectFrom('admin_accounts')
      .select(['mfa_secret_enc', 'status'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('active');
    expect(stored.mfa_secret_enc).not.toContain(secret);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select(['action', 'reason'])
      .where('action', '=', 'admin.invited')
      .where('target_id', '=', invite.body.adminId)
      .execute();
    expect(audit).toEqual([{ action: 'admin.invited', reason: 'Catalog review cover for pilot' }]);

    const list = await h
      .http()
      .get('/v1/admin/admins?limit=100')
      .set('Authorization', bearer(superadmin))
      .expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
  });

  it('rejects an expired invitation', async () => {
    const superadmin = await adminLogin(await provisionAdmin(['superadmin']));
    const email = uniqueEmail('late');
    await h
      .http()
      .post('/v1/admin/admins/invites')
      .set('Authorization', bearer(superadmin))
      .send({ email, displayName: 'Late', roles: ['support'], reason: 'Support rota for pilot' })
      .expect(201);
    const token = new URL(h.notifier.lastTo(email)?.params['link'] ?? '').searchParams.get('token');
    h.clock.advance(72 * 3600 + 1);
    try {
      const res = await h
        .http()
        .post('/v1/admin/invites/accept')
        .send({ token, password: PASSWORD })
        .expect(400);
      expect(res.body.error.code).toBe('INVITE_INVALID');
    } finally {
      h.clock.advance(-(72 * 3600 + 1));
    }
  });
});
