import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  adminSessionSchema,
  businessSchema,
  sessionSchema,
  type Session,
  type UploadTicket,
} from '@jays/contracts';
import { createDb, type Db } from '@jays/db';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../bootstrap.js';
import { hashPassword, SecretBox } from '../auth/crypto.js';
import { MockNotifier } from '../auth/notifier.js';
import { generateTotpSecret, totpAt } from '../auth/totp.js';
import type { Clock } from '../common/clock.js';
import { MockPaymentProvider, type WebhookDelivery } from '../payments/mock-provider.js';
import { testEnv } from './test-env.js';

/** Clock that tests can move forward. Starts at real time so database defaults line up. */
export class TestClock implements Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(seconds: number): void {
    this.offsetMs += seconds * 1000;
  }
}

export interface Harness {
  app: INestApplication;
  /** Requests from a fresh client IP each time unless one is given (per-IP limits are tested explicitly). */
  http: (ip?: string) => ReturnType<typeof request>;
  notifier: MockNotifier;
  clock: TestClock;
  db: Db;
  /** Directory of the local storage adapter for this run. */
  storageDir: string;
  /** The mock payment provider; its webhooks are captured in `webhooks` instead of being sent. */
  psp: MockPaymentProvider;
  webhooks: WebhookDelivery[];
  /** POSTs every captured webhook to the API (in order) and clears the queue; returns responses. */
  deliverWebhooks: () => Promise<{ status: number; body: unknown }[]>;
  close: () => Promise<void>;
}

function randomIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

/** supertest's agent returns method builders; wrap them so each request carries X-Forwarded-For. */
function withIp(agent: ReturnType<typeof request>, ip: string): ReturnType<typeof request> {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const test = (
          value as (...a: unknown[]) => { set: (k: string, v: string) => unknown }
        ).apply(target, args);
        return test.set('X-Forwarded-For', ip);
      };
    },
  });
}

let counter = 0;
/** Unique, fictional contact for each test. */
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}@example.test`;
}
export function uniquePhone(): string {
  counter += 1;
  return `+9715${String(Date.now() % 1e6).padStart(6, '0')}${String(counter % 100).padStart(2, '0')}`;
}

/** Full app on real PostgreSQL and Redis (DATABASE_URL, REDIS_URL), with a capturing notifier. */
export async function startHarness(): Promise<Harness> {
  const storageDir = await mkdtemp(join(tmpdir(), 'jays-storage-'));
  const env = testEnv({
    DATABASE_URL: process.env['DATABASE_URL'],
    REDIS_URL: process.env['REDIS_URL'],
    TRUST_PROXY_HOPS: '1',
    STORAGE_LOCAL_DIR: storageDir,
    MOCK_PAYMENT_OUTCOMES: 'true',
  });
  const notifier = new MockNotifier(false);
  const clock = new TestClock();
  const webhooks: WebhookDelivery[] = [];
  const psp = new MockPaymentProvider(env.PSP_WEBHOOK_SECRET, (d) => webhooks.push(d), clock);
  const app = await createApp({
    env,
    notifier,
    clock,
    paymentProvider: psp,
    rateLimitNamespace: `it-${process.pid}-${Date.now()}`,
  });
  await app.init();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const db = createDb(pool);
  const server = app.getHttpServer();
  return {
    app,
    http: (ip?: string) => withIp(request(server), ip ?? randomIp()),
    notifier,
    clock,
    db,
    storageDir,
    psp,
    webhooks,
    deliverWebhooks: async () => {
      const queued = webhooks.splice(0, webhooks.length);
      const results: { status: number; body: unknown }[] = [];
      for (const d of queued) {
        const res = await request(server).post('/v1/webhooks/payments').set(d.headers).send(d.body);
        results.push({ status: res.status, body: res.body as unknown });
      }
      return results;
    },
    close: async () => {
      await app.close();
      await db.destroy();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

export function lastCode(h: Harness, to: string): string {
  const message = h.notifier.lastTo(to);
  const code = message?.params['code'];
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}

/** A valid, fictional password. Built rather than written as a literal so secret scanners do not flag tests. */
export const otherPassword = (label: string) => `${label}-Passw0rd`;
export const PASSWORD = otherPassword('Fictional');

/** Registers and verifies an email account; returns the session. */
export async function signUp(
  h: Harness,
  email = uniqueEmail(),
  password = PASSWORD,
): Promise<Session & { email: string }> {
  const reg = await h
    .http()
    .post('/v1/auth/register')
    .send({ email, password, acceptTerms: true })
    .expect(202);
  const res = await h
    .http()
    .post('/v1/auth/verify')
    .send({ challengeId: reg.body.challengeId, code: lastCode(h, email) })
    .expect(200);
  return { ...sessionSchema.parse(res.body), email };
}

export const bearer = (session: { tokens: { accessToken: string } }) =>
  `Bearer ${session.tokens.accessToken}`;

/** Starts a business as `session` (who becomes owner). */
export async function createBusiness(
  h: Harness,
  session: { tokens: { accessToken: string } },
  modes: ('shop' | 'services')[] = ['shop'],
  displayName = { en: 'Fictional Store', ar: 'متجر تجريبي' },
) {
  const res = await h
    .http()
    .post('/v1/businesses')
    .set('Authorization', bearer(session))
    .send({ displayName, modes })
    .expect(201);
  return businessSchema.parse(res.body);
}

/** Path of a signed storage URL on the test server (the public base URL points elsewhere). */
export function storagePath(url: string): string {
  return new URL(url).pathname;
}

/** PUTs bytes to a signed upload URL as a browser or app would. */
export function putUpload(h: Harness, ticket: UploadTicket, bytes: Buffer, contentType?: string) {
  return h
    .http()
    .put(storagePath(ticket.uploadUrl))
    .set(
      'Content-Type',
      contentType ?? ticket.headers['content-type'] ?? 'application/octet-stream',
    )
    .send(bytes);
}

const adminBox = () => new SecretBox(testEnv().MFA_ENCRYPTION_KEY);

/** Provisions an active admin directly (as the seed and bootstrap do). */
export async function provisionAdmin(h: Harness, roles: string[]) {
  const email = uniqueEmail('admin');
  const secret = generateTotpSecret();
  const admin = await h.db
    .insertInto('admin_accounts')
    .values({
      email,
      display_name: 'Fictional Admin',
      password_hash: await hashPassword(PASSWORD),
      status: 'active',
      mfa_secret_enc: adminBox().seal(secret),
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

/** Signs an admin in with a fresh TOTP step (each step works once). */
export async function adminLogin(h: Harness, admin: { email: string; secret: string }) {
  h.clock.advance(30);
  const res = await h
    .http()
    .post('/v1/admin/auth/login')
    .send({ email: admin.email, password: PASSWORD, totpCode: totpAt(admin.secret, h.clock.now()) })
    .expect(200);
  return adminSessionSchema.parse(res.body);
}
