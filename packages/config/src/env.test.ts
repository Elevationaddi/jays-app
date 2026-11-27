import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv, workerEnvSchema } from './env.js';

const local = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://jays:jays@localhost:5432/jays',
  REDIS_URL: 'redis://localhost:6379',
  JWT_KEYS: 'local-dev-only-0000000000000000000000000000',
  STORAGE_BUCKET: 'jays-local',
  PSP_WEBHOOK_SECRET: 'local-dev-only-webhook-secret',
};

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as EnvValidationError).issues.map((i) => i.path);
  }
  throw new Error('expected EnvValidationError');
}

describe('apiEnvSchema', () => {
  it('accepts the local example environment and applies defaults', () => {
    const env = parseEnv(apiEnvSchema, local);
    expect(env.API_PORT).toBe(3000);
    expect(env.PSP_PROVIDER).toBe('mock');
    expect(env.MOCK_PAYMENT_OUTCOMES).toBe(false);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('treats empty strings as unset', () => {
    expect(issuesOf(() => parseEnv(apiEnvSchema, { ...local, DATABASE_URL: '' }))).toContain(
      'DATABASE_URL',
    );
  });

  it('rejects malformed URLs without echoing the value', () => {
    const secret = 'mysql://user:super-secret@host/db';
    try {
      parseEnv(apiEnvSchema, { ...local, DATABASE_URL: secret });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).not.toContain('super-secret');
    }
  });

  it('parses the mock payment switch and CORS list', () => {
    const env = parseEnv(apiEnvSchema, {
      ...local,
      MOCK_PAYMENT_OUTCOMES: 'true',
      CORS_ORIGINS: 'http://localhost:3001, http://localhost:3002',
    });
    expect(env.MOCK_PAYMENT_OUTCOMES).toBe(true);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3001', 'http://localhost:3002']);
  });

  it('refuses mock payments, dev switches and example secrets in production', () => {
    const paths = issuesOf(() =>
      parseEnv(apiEnvSchema, {
        ...local,
        APP_ENV: 'production',
        MOCK_PAYMENT_OUTCOMES: 'true',
        CORS_ORIGINS: 'http://example.test',
      }),
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'PSP_PROVIDER',
        'MOCK_PAYMENT_OUTCOMES',
        'MAPS_KEY',
        'EMAIL_KEY',
        'JWT_KEYS',
        'PSP_WEBHOOK_SECRET',
        'CORS_ORIGINS',
      ]),
    );
  });
});

describe('workerEnvSchema', () => {
  it('needs only the shared infrastructure variables', () => {
    const env = parseEnv(workerEnvSchema, {
      DATABASE_URL: local.DATABASE_URL,
      REDIS_URL: local.REDIS_URL,
    });
    expect(env.APP_ENV).toBe('local');
  });

  it('rejects a non-redis queue URL', () => {
    expect(
      issuesOf(() =>
        parseEnv(workerEnvSchema, { DATABASE_URL: local.DATABASE_URL, REDIS_URL: 'http://x' }),
      ),
    ).toEqual(['REDIS_URL']);
  });
});

describe('workerEnvSchema in production', () => {
  it('does not demand API-only keys', () => {
    const env = parseEnv(workerEnvSchema, {
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://app:pw@db.internal:5432/jays',
      REDIS_URL: 'rediss://cache.internal:6380',
    });
    expect(env.APP_ENV).toBe('production');
  });
});
