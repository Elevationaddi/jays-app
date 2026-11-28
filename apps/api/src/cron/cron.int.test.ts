import { createServer } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRateLimiter } from '../common/rate-limit.js';
import { type Harness, startHarness } from '../testing/harness.js';
import { createVercelHandler } from '../vercel.js';

// Vercel mode (ADR-0033): no Redis, timers off, jobs from the protected cron routes.
const CRON_SECRET = 'fictional-cron-secret-for-tests-000000';
let h: Harness;
beforeAll(async () => {
  h = await startHarness({
    env: { RATE_LIMIT_STORE: 'postgres', SCHEDULERS: 'off', CRON_SECRET, DB_POOL_MAX: '3' },
  });
});
afterAll(async () => {
  await h.close();
});

describe('cron routes (ADR-0033)', () => {
  it('refuses a missing or wrong secret and unknown schedules', async () => {
    await h.http().get('/v1/internal/cron/minute').expect(401);
    await h
      .http()
      .get('/v1/internal/cron/minute')
      .set('Authorization', 'Bearer wrong-secret')
      .expect(401);
    await h
      .http()
      .get('/v1/internal/cron/constructor')
      .set('Authorization', `Bearer ${CRON_SECRET}`)
      .expect(404);
  });

  it('runs every schedule and reports each step', async () => {
    for (const [schedule, steps] of [
      ['minute', ['notifications', 'expire-unpaid-orders', 'expire-booking-holds']],
      ['five-minutes', ['booking-reminders', 'rate-limit-cleanup']],
      ['hourly', ['mark-earnings-eligible', 'complete-account-deletions', 'finance']],
    ] as const) {
      const res = await h
        .http()
        .get(`/v1/internal/cron/${schedule}`)
        .set('Authorization', `Bearer ${CRON_SECRET}`)
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Object.keys(res.body.results)).toEqual(steps);
      for (const step of steps) expect(typeof res.body.results[step]).toBe('number');
    }
  });

  it('is disabled when no cron secret is configured', async () => {
    const other = await startHarness();
    try {
      await other
        .http()
        .get('/v1/internal/cron/minute')
        .set('Authorization', 'Bearer anything')
        .expect(404);
    } finally {
      await other.close();
    }
  });
});

describe('PostgreSQL rate limits (ADR-0033)', () => {
  it('counts a fixed window atomically and reports when to retry', async () => {
    const limiter = new PostgresRateLimiter(h.db, `it-${Date.now()}`);
    const rule = { name: 'test', limit: 5, windowSeconds: 60 };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => limiter.consume(rule, 'subject')),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const blocked = results.find((r) => !r.allowed)!;
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    // Another subject has its own window.
    expect((await limiter.consume(rule, 'other')).allowed).toBe(true);
  });

  it('restarts a window that has ended', async () => {
    const limiter = new PostgresRateLimiter(h.db, `it-${Date.now()}-r`);
    const rule = { name: 'short', limit: 1, windowSeconds: 1 };
    expect((await limiter.consume(rule, 's')).allowed).toBe(true);
    expect((await limiter.consume(rule, 's')).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await limiter.consume(rule, 's')).allowed).toBe(true);
  });

  it('limits sign-in attempts without Redis', async () => {
    let last = 0;
    for (let i = 0; i < 15; i++) {
      const res = await h
        .http('203.0.113.77')
        .post('/v1/auth/login')
        .send({ identifier: 'nobody@example.test', password: 'Wrong-Passw0rd-x' });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it('reports ready without a Redis check', async () => {
    const res = await h.http().get('/v1/health/ready').expect(200);
    expect(res.body.checks).toEqual({ database: 'up', redis: 'not_used' });
  });
});

describe('Vercel function entry (ADR-0033)', () => {
  const raw = {
    APP_ENV: 'test',
    DATABASE_URL: process.env['DATABASE_URL'],
    RATE_LIMIT_STORE: 'postgres',
    SCHEDULERS: 'off',
    CRON_SECRET,
    JWT_KEYS: 'test:local-dev-only-test-000000000000000000000',
    OTP_SECRET: 'local-dev-only-test-otp-0000000000000000',
    MFA_ENCRYPTION_KEY: 'local-dev-only-test-mfa-0000000000000000',
    STORAGE_BUCKET: 'jays-test',
    STORAGE_SIGNING_SECRET: 'local-dev-only-test-storage-00000000000000',
    PSP_WEBHOOK_SECRET: 'local-dev-only-test-secret',
  };

  it('serves the API from one reused application', async () => {
    const handler = createVercelHandler(raw);
    const server = createServer((req, res) => void handler(req, res));
    try {
      await request(server).get('/v1/health').expect(200);
      const ready = await request(server).get('/v1/health/ready').expect(200);
      expect(ready.body.status).toBe('ready');
      await request(server).get('/v1/emirates').expect(200);
    } finally {
      await handler.close();
    }
  });

  it('answers 503 without details when the configuration is invalid', async () => {
    const handler = createVercelHandler({ ...raw, OTP_SECRET: 'short' });
    const server = createServer((req, res) => void handler(req, res));
    const res = await request(server).get('/v1/health').expect(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('OTP_SECRET');
  });
});
