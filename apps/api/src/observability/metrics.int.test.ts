import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../bootstrap.js';
import { testEnv } from '../testing/test-env.js';

const TOKEN = 'local-dev-only-metrics-token-000000000000';
const deps = { DATABASE_URL: process.env['DATABASE_URL'], REDIS_URL: process.env['REDIS_URL'] };

describe('GET /v1/metrics', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ env: testEnv({ ...deps, METRICS_TOKEN: TOKEN }) });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a missing or wrong token', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/v1/metrics')).status).toBe(401);
    expect(
      (await request(server).get('/v1/metrics').set('authorization', `Bearer ${TOKEN}x`)).status,
    ).toBe(401);
  });

  it('reports request metrics by route pattern and operational gauges', async () => {
    const server = app.getHttpServer();
    await request(server).get('/v1/health');
    await request(server).get('/v1/stores/00000000-0000-0000-0000-000000000000');
    await request(server).get('/v1/no-such-route');
    const res = await request(server).get('/v1/metrics').set('authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toMatch(
      /jays_http_requests_total\{method="GET",route="\/v1\/health",status="200"\} \d+/,
    );
    expect(res.text).toContain('route="unmatched",status="404"');
    // Ids never become labels.
    expect(res.text).not.toContain('00000000-0000-0000-0000-000000000000');
    expect(res.text).toMatch(
      /jays_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/health",le="0\.5"\} \d+/,
    );
    for (const name of [
      'jays_outbox_pending',
      'jays_outbox_oldest_pending_seconds',
      'jays_booking_holds_stuck',
      'jays_stock_reservations_stuck',
      'jays_payments_needing_attention',
      'jays_reconciliation_open_mismatches',
      'jays_support_tickets_overdue',
    ]) {
      expect(res.text).toMatch(new RegExp(`^${name} \\d+(\\.\\d+)?$`, 'm'));
    }
  });

  it('is disabled when no token is configured', async () => {
    const off = await createApp({ env: testEnv(deps) });
    await off.init();
    try {
      expect((await request(off.getHttpServer()).get('/v1/metrics')).status).toBe(404);
    } finally {
      await off.close();
    }
  });
});
