import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../bootstrap.js';
import { signupAllowed } from '../auth/auth.service.js';
import { testEnv } from '../testing/test-env.js';
import type { DependencyProbe } from '../health/dependencies.js';
import { isOpenPath } from './staging-gate.js';

const TOKEN = 'fictional-staging-access-token-0000000000';
const up = (name: DependencyProbe['name']): DependencyProbe => ({ name, check: async () => true });

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(token?: string) {
  app = await createApp({
    env: testEnv(token ? { STAGING_ACCESS_TOKEN: token } : {}),
    probes: [up('database'), up('redis')],
  });
  await app.init();
  return app.getHttpServer();
}

describe('private staging gate (ADR-0035)', () => {
  it('refuses API requests without the access header, with the error envelope', async () => {
    const server = await start(TOKEN);
    const res = await request(server).get('/v1/emirates').expect(401);
    expect(res.body.error.code).toBe('STAGING_ACCESS_REQUIRED');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    await request(server).get('/v1/emirates').set('x-staging-access', 'wrong').expect(401);
  });

  it('lets requests with the right header through', async () => {
    const server = await start(TOKEN);
    const res = await request(server).get('/v1/health').set('x-staging-access', TOKEN);
    expect(res.status).toBe(200);
    // Past the gate, routing works normally (an unknown path is the API's own 404).
    await request(server).get('/v1/no-such-route').set('x-staging-access', TOKEN).expect(404);
  });

  it('keeps health, webhooks and cron reachable, and serves a disallow-all robots.txt', async () => {
    const server = await start(TOKEN);
    await request(server).get('/v1/health').expect(200);
    await request(server).get('/v1/health/ready').expect(200);
    const robots = await request(server).get('/robots.txt').expect(200);
    expect(robots.text).toContain('Disallow: /');
    // Webhooks still verify their signature: no header means 400/401 from the route, not the gate.
    const hook = await request(server).post('/v1/webhooks/payments').send({});
    expect(hook.body?.error?.code).not.toBe('STAGING_ACCESS_REQUIRED');
  });

  it('does nothing outside staging (no token configured)', async () => {
    const server = await start();
    const res = await request(server).get('/v1/health').expect(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });

  it('only opens the listed prefixes, not look-alikes', () => {
    expect(isOpenPath('/v1/health')).toBe(true);
    expect(isOpenPath('/v1/health/ready')).toBe(true);
    expect(isOpenPath('/v1/healthcheck')).toBe(false);
    expect(isOpenPath('/v1/webhooks/payments')).toBe(true);
    expect(isOpenPath('/v1/storage/objects/abc')).toBe(true);
    expect(isOpenPath('/v1/me')).toBe(false);
    expect(isOpenPath('/v1/admin/health')).toBe(false);
  });
});

describe('signupAllowed', () => {
  const allowlist = {
    SIGNUP_MODE: 'allowlist' as const,
    SIGNUP_ALLOWLIST: ['a@x.test', '@demo.example'],
  };
  it('allows everyone when sign-up is open', () => {
    expect(signupAllowed({ SIGNUP_MODE: 'open', SIGNUP_ALLOWLIST: [] }, null)).toBe(true);
  });
  it('allows only listed emails and domains, case-insensitively', () => {
    expect(signupAllowed(allowlist, 'A@X.test')).toBe(true);
    expect(signupAllowed(allowlist, 'someone@demo.example')).toBe(true);
    expect(signupAllowed(allowlist, 'someone@sub.demo.example')).toBe(false);
    expect(signupAllowed(allowlist, 'b@x.test')).toBe(false);
    expect(signupAllowed(allowlist, null)).toBe(false);
  });
});
