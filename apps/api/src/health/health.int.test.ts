import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../bootstrap.js';
import { testEnv } from '../testing/test-env.js';

// Real PostgreSQL and Redis (pnpm dev:deps locally; service containers in CI).
describe('readiness against real dependencies', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const env = testEnv({
      DATABASE_URL: process.env['DATABASE_URL'],
      REDIS_URL: process.env['REDIS_URL'],
    });
    app = await createApp({ env });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports PostgreSQL and Redis as up', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health/ready');
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'up', redis: 'up' } });
    expect(res.status).toBe(200);
  });
});
