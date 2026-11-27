import type { INestApplication } from '@nestjs/common';
import { apiEnvSchema, parseEnv } from '@jays/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../bootstrap.js';

// Real PostgreSQL and Redis (pnpm dev:deps locally; service containers in CI).
describe('readiness against real dependencies', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const env = parseEnv(apiEnvSchema, {
      ...process.env,
      APP_ENV: 'test',
      JWT_KEYS: process.env['JWT_KEYS'] ?? 'local-dev-only-test-000000000000000000000',
      STORAGE_BUCKET: process.env['STORAGE_BUCKET'] ?? 'jays-test',
      PSP_WEBHOOK_SECRET: process.env['PSP_WEBHOOK_SECRET'] ?? 'local-dev-only-test-secret',
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
