import { apiEnvSchema, type ApiEnv, parseEnv } from '@jays/config';

/** A valid non-production environment for tests and OpenAPI generation. Fictional values only. */
export function testEnv(overrides: Record<string, string | undefined> = {}): ApiEnv {
  return parseEnv(apiEnvSchema, {
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://unused@localhost/unused',
    REDIS_URL: 'redis://localhost:6379',
    JWT_KEYS: 'test:local-dev-only-test-000000000000000000000',
    OTP_SECRET: 'local-dev-only-test-otp-0000000000000000',
    MFA_ENCRYPTION_KEY: 'local-dev-only-test-mfa-0000000000000000',
    STORAGE_BUCKET: 'jays-test',
    PSP_WEBHOOK_SECRET: 'local-dev-only-test-secret',
    CORS_ORIGINS: 'http://localhost:3001',
    ...overrides,
  });
}
