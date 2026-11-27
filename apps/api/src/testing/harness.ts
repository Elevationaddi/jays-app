import type { INestApplication } from '@nestjs/common';
import { sessionSchema, type Session } from '@jays/contracts';
import { createDb, type Db } from '@jays/db';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../bootstrap.js';
import { MockNotifier } from '../auth/notifier.js';
import type { Clock } from '../common/clock.js';
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
  const env = testEnv({
    DATABASE_URL: process.env['DATABASE_URL'],
    REDIS_URL: process.env['REDIS_URL'],
    TRUST_PROXY_HOPS: '1',
  });
  const notifier = new MockNotifier(false);
  const clock = new TestClock();
  const app = await createApp({
    env,
    notifier,
    clock,
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
    close: async () => {
      await app.close();
      await db.destroy();
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
