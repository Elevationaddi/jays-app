import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../bootstrap.js';
import { productionDatabaseOk } from './infrastructure.js';
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

// ADR-0038: a staging database (demo data, or marked as another environment) never passes
// production readiness. Each case runs in a transaction that is rolled back.
describe('production database guard', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  async function inTransaction(setup: string | null): Promise<boolean> {
    await client.query('BEGIN');
    try {
      if (setup) await client.query(setup);
      return await productionDatabaseOk(client);
    } finally {
      await client.query('ROLLBACK');
    }
  }

  it('passes an unmarked database without demonstration data', async () => {
    expect(await inTransaction(null)).toBe(true);
  });

  it('passes a database marked as production', async () => {
    expect(
      await inTransaction(`INSERT INTO environment_marker (environment) VALUES ('production')`),
    ).toBe(true);
  });

  it('refuses a database marked as staging', async () => {
    expect(
      await inTransaction(`INSERT INTO environment_marker (environment) VALUES ('staging')`),
    ).toBe(false);
  });

  it('refuses a database that holds demonstration accounts', async () => {
    const demoUser = `INSERT INTO users (email, password_hash, terms_version, terms_accepted_at, is_demo)
       VALUES ('guard@demo.jays.example', '$argon2id$not-a-real-hash', 'demo', now(), true)`;
    expect(await inTransaction(demoUser)).toBe(false);
  });
});
