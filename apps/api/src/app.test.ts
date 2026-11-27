import type { INestApplication } from '@nestjs/common';
import { apiEnvSchema, parseEnv } from '@jays/config';
import { errorEnvelopeSchema, livenessSchema, readinessSchema } from '@jays/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './bootstrap.js';
import type { DependencyProbe } from './health/dependencies.js';

const env = parseEnv(apiEnvSchema, {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://unused@localhost/unused',
  REDIS_URL: 'redis://localhost:6379',
  JWT_KEYS: 'local-dev-only-test-000000000000000000000',
  STORAGE_BUCKET: 'jays-test',
  PSP_WEBHOOK_SECRET: 'local-dev-only-test-secret',
  CORS_ORIGINS: 'http://localhost:3001',
});

const up = (name: DependencyProbe['name']): DependencyProbe => ({ name, check: async () => true });
const down = (name: DependencyProbe['name']): DependencyProbe => ({
  name,
  check: async () => {
    throw new Error('connection refused');
  },
});

let app: INestApplication | undefined;
async function start(probes: DependencyProbe[]) {
  app = await createApp({ env, probes });
  await app.init();
  return app.getHttpServer();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /v1/health', () => {
  it('reports liveness without touching dependencies', async () => {
    const server = await start([down('database'), down('redis')]);
    const res = await request(server).get('/v1/health').expect(200);
    expect(livenessSchema.parse(res.body).service).toBe('api');
  });

  it('issues a request id and echoes a safe caller-supplied one', async () => {
    const server = await start([]);
    const generated = await request(server).get('/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await request(server).get('/v1/health').set('x-request-id', 'client-req-12345');
    expect(echoed.headers['x-request-id']).toBe('client-req-12345');
    const unsafe = await request(server).get('/v1/health').set('x-request-id', 'bad id <script>');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /v1/health/ready', () => {
  it('is ready when every dependency is up', async () => {
    const server = await start([up('database'), up('redis')]);
    const res = await request(server).get('/v1/health/ready').expect(200);
    expect(readinessSchema.parse(res.body)).toEqual({
      status: 'ready',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('returns 503 and names the failing dependency', async () => {
    const server = await start([up('database'), down('redis')]);
    const res = await request(server).get('/v1/health/ready').expect(503);
    expect(res.body).toEqual({ status: 'not_ready', checks: { database: 'up', redis: 'down' } });
  });
});

describe('errors and headers', () => {
  it('returns the error envelope with the request id for unknown routes', async () => {
    const server = await start([]);
    const res = await request(server)
      .get('/v1/nope')
      .set('x-request-id', 'trace-abcdef12')
      .expect(404);
    const body = errorEnvelopeSchema.parse(res.body);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', requestId: 'trace-abcdef12' });
  });

  it('does not serve routes outside /v1', async () => {
    const server = await start([]);
    await request(server).get('/health').expect(404);
  });

  it('allows only configured CORS origins and sets security headers', async () => {
    const server = await start([]);
    const allowed = await request(server).get('/v1/health').set('Origin', 'http://localhost:3001');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    const denied = await request(server).get('/v1/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
