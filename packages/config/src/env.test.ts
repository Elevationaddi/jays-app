import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv, workerEnvSchema } from './env.js';

const local = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://jays:jays@localhost:5432/jays',
  REDIS_URL: 'redis://localhost:6379',
  JWT_KEYS: 'k1:local-dev-only-0000000000000000000000000000',
  OTP_SECRET: 'local-dev-only-otp-0000000000000000000000',
  MFA_ENCRYPTION_KEY: 'local-dev-only-mfa-0000000000000000000000',
  STORAGE_BUCKET: 'jays-local',
  STORAGE_SIGNING_SECRET: 'local-dev-only-storage-000000000000000000',
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
    expect(env.STORAGE_PROVIDER).toBe('local');
    expect(env.MALWARE_SCANNER).toBe('mock');
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

  it('accepts Stripe only with test-mode keys, in every environment', () => {
    const stripe = { ...local, PSP_PROVIDER: 'stripe' };
    expect(issuesOf(() => parseEnv(apiEnvSchema, stripe))).toEqual(['PSP_API_KEY']);
    const env = parseEnv(apiEnvSchema, {
      ...stripe,
      PSP_API_KEY: 'sk_test_FICTIONAL0000000000',
      PSP_PUBLISHABLE_KEY: 'pk_test_FICTIONAL0000000000',
    });
    expect(env.PSP_PROVIDER).toBe('stripe');
    expect(
      issuesOf(() =>
        parseEnv(apiEnvSchema, {
          ...stripe,
          PSP_API_KEY: 'sk_live_FICTIONAL0000000000',
          PSP_PUBLISHABLE_KEY: 'pk_live_FICTIONAL0000000000',
        }),
      ),
    ).toEqual(['PSP_API_KEY', 'PSP_PUBLISHABLE_KEY']);
  });

  it('needs a key and sender for Resend, and a service account for FCM', () => {
    expect(issuesOf(() => parseEnv(apiEnvSchema, { ...local, NOTIFY_PROVIDER: 'resend' }))).toEqual(
      ['EMAIL_KEY', 'EMAIL_FROM'],
    );
    expect(issuesOf(() => parseEnv(apiEnvSchema, { ...local, PUSH_PROVIDER: 'fcm' }))).toEqual([
      'FCM_SERVICE_ACCOUNT_JSON',
    ]);
    const env = parseEnv(apiEnvSchema, {
      ...local,
      NOTIFY_PROVIDER: 'resend',
      EMAIL_KEY: 're_fictional',
      EMAIL_FROM: 'JAYS <no-reply@mail.example.test>',
      PUSH_PROVIDER: 'fcm',
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'jays-fictional',
        client_email: 'push@jays-fictional.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\\nfictional\\n-----END PRIVATE KEY-----\\n',
      }),
    });
    expect(env.EMAIL_DAILY_LIMIT).toBe(100);
    expect(env.EMAIL_MONTHLY_LIMIT).toBe(3000);
  });

  it('refuses mock payments, dev switches and example secrets in production', () => {
    const paths = issuesOf(() =>
      parseEnv(apiEnvSchema, {
        ...local,
        APP_ENV: 'production',
        MOCK_PAYMENT_OUTCOMES: 'true',
        DELIVERY_PARTNER: 'mock',
        PUSH_PROVIDER: 'mock',
        CORS_ORIGINS: 'http://example.test',
      }),
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'PSP_PROVIDER',
        'MOCK_PAYMENT_OUTCOMES',
        'MAPS_KEY',
        'EMAIL_KEY',
        'METRICS_TOKEN',
        'JWT_KEYS',
        'PSP_WEBHOOK_SECRET',
        'OTP_SECRET',
        'MFA_ENCRYPTION_KEY',
        'NOTIFY_PROVIDER',
        'ADMIN_WEB_URL',
        'BUSINESS_WEB_URL',
        'CORS_ORIGINS',
        'STORAGE_PROVIDER',
        'STORAGE_SIGNING_SECRET',
        'MALWARE_SCANNER',
        'DELIVERY_PARTNER',
        'PUSH_PROVIDER',
        'API_PUBLIC_URL',
      ]),
    );
  });
});

describe('JWT_KEYS', () => {
  it('parses an ordered key set; the first key signs', () => {
    const env = parseEnv(apiEnvSchema, {
      ...local,
      JWT_KEYS:
        'new:local-dev-only-new-0000000000000000000000, old:local-dev-only-old-00000000000000000000000',
    });
    expect(env.JWT_KEYS.map((k) => k.kid)).toEqual(['new', 'old']);
  });

  it.each([
    ['no key id', 'local-dev-only-0000000000000000000000000000'],
    ['short secret', 'k1:short'],
    [
      'duplicate key ids',
      'a:local-dev-only-0000000000000000000000,a:local-dev-only-1111111111111111111111',
    ],
  ])('rejects %s without echoing it', (_label, value) => {
    try {
      parseEnv(apiEnvSchema, { ...local, JWT_KEYS: value });
      throw new Error('expected failure');
    } catch (error) {
      expect((error as EnvValidationError).issues.map((i) => i.path)).toEqual(['JWT_KEYS']);
      expect((error as Error).message).not.toContain('0000');
    }
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
