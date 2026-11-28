import { z } from 'zod';

/**
 * Environment schema shared by every server process.
 *
 * Rules (see docs/adr/0006-environment-and-secrets.md):
 * - Values are validated at process start; a process with an invalid environment does not start.
 * - Error messages name the variable but never echo its value, so secrets cannot leak into logs.
 * - Development-only switches and mock providers are refused when APP_ENV=production.
 */

export const APP_ENVS = ['local', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/**
 * Payment providers with an adapter. `stripe` is Stripe Connect in **test mode only** (ADR-0030):
 * live keys are refused in every environment until the founder approves live payments.
 */
export const PSP_PROVIDERS = ['mock', 'stripe'] as const;

/** Stripe test-mode key prefixes. A live key (`sk_live_`, `rk_live_`, `pk_live_`) is refused. */
export const STRIPE_TEST_SECRET_KEY = /^(sk|rk)_test_[A-Za-z0-9]{10,}$/;
export const STRIPE_TEST_PUBLISHABLE_KEY = /^pk_test_[A-Za-z0-9]{10,}$/;

/**
 * Email providers with an adapter (ADR-0031). `resend` sends email through Resend's free plan.
 * There is no SMS provider (ADR-0024): with `resend`, sign-up and recovery by phone are refused.
 */
export const NOTIFY_PROVIDERS = ['mock', 'resend'] as const;

/**
 * Push providers (ADR-0031). `none` sends no push; `mock` records pushes locally and production
 * refuses it; `fcm` uses Firebase Cloud Messaging (HTTP v1) on the no-cost Spark plan.
 */
export const PUSH_PROVIDERS = ['none', 'mock', 'fcm'] as const;

/**
 * Object storage adapters. `local` keeps files on disk and serves HMAC-signed URLs from the API
 * itself, so uploads behave like signed S3 URLs locally. A real S3-compatible adapter is required
 * before production (ADR-0012), so production refuses `local`.
 */
export const STORAGE_PROVIDERS = ['local', 'supabase'] as const;

/**
 * Malware scanners. The mock flags the EICAR test file; production refuses it (ADR-0012).
 * `clamav` talks to a clamd the founder hosts (ADR-0032); production requires TLS to it.
 */
export const MALWARE_SCANNERS = ['mock', 'clamav'] as const;

/**
 * Delivery-partner adapters (ADR-0029). `none`: businesses enter tracking themselves. `mock`
 * books fictional shipments for local testing; production refuses it. No paid provider is wired.
 */
export const DELIVERY_PARTNERS = ['none', 'mock'] as const;
/** Where request rate limits are counted (ADR-0033): Redis, or PostgreSQL on Vercel (no Redis). */
export const RATE_LIMIT_STORES = ['redis', 'postgres'] as const;
/** `off` on Vercel: background jobs run from the protected cron routes instead of timers. */
export const SCHEDULER_MODES = ['on', 'off'] as const;

/** Marker that every committed example secret carries, so production can reject copied examples. */
export const LOCAL_SECRET_MARKER = 'local-dev-only';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' });
const redisUrl = z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' });

/**
 * JWT signing keys: `kid:secret[,kid:secret...]`. The first key signs; every key verifies, so a
 * new key can be put first and the old one removed after the access-token lifetime (ADR-0009).
 */
export interface SigningKey {
  kid: string;
  secret: string;
}
const KID = /^[A-Za-z0-9_-]{1,64}$/;
export const jwtKeysSchema = z.string().transform((value, ctx): SigningKey[] => {
  const keys: SigningKey[] = [];
  for (const entry of value.split(',')) {
    const index = entry.indexOf(':');
    const kid = entry.slice(0, index).trim();
    const secret = entry.slice(index + 1).trim();
    if (index <= 0 || !KID.test(kid)) {
      ctx.addIssue({ code: 'custom', message: 'each entry must be kid:secret' });
      return z.NEVER;
    }
    if (secret.length < 32) {
      ctx.addIssue({ code: 'custom', message: 'each secret must be at least 32 characters' });
      return z.NEVER;
    }
    keys.push({ kid, secret });
  }
  if (new Set(keys.map((k) => k.kid)).size !== keys.length) {
    ctx.addIssue({ code: 'custom', message: 'key ids must be unique' });
    return z.NEVER;
  }
  return keys;
});

const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const baseShape = {
  APP_ENV: z.enum(APP_ENVS).default('local'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
};

const apiShape = {
  ...baseShape,
  /** Only needed when RATE_LIMIT_STORE=redis. */
  REDIS_URL: redisUrl.optional(),
  RATE_LIMIT_STORE: z.enum(RATE_LIMIT_STORES).default('redis'),
  SCHEDULERS: z.enum(SCHEDULER_MODES).default('on'),
  /** Connections per API instance. Keep small (3) on Vercel, behind Supabase's pooler. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Bearer secret Vercel Cron sends to /v1/internal/cron/*. Unset disables those routes. */
  CRON_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: commaList,
  JWT_KEYS: jwtKeysSchema,
  /** HMAC key for one-time codes, so a database leak does not reveal live codes. */
  OTP_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Key material for encrypting admin TOTP secrets at rest (HKDF-derived AES-256-GCM key). */
  MFA_ENCRYPTION_KEY: z.string().min(32, 'must be at least 32 characters'),
  NOTIFY_PROVIDER: z.enum(NOTIFY_PROVIDERS).default('mock'),
  /** Sender for Resend, such as `JAYS <no-reply@mail.example.com>` on a verified domain. */
  EMAIL_FROM: z.string().min(3).max(200).optional(),
  /** Resend Free allows 100 emails a day and 3,000 a month; never set these above the plan. */
  EMAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(100),
  EMAIL_MONTHLY_LIMIT: z.coerce.number().int().min(1).max(3_000_000).default(3000),
  PUSH_PROVIDER: z.enum(PUSH_PROVIDERS).default('none'),
  /** The Firebase service account JSON (one line). Only the API project holds it. */
  FCM_SERVICE_ACCOUNT_JSON: z.string().min(2).optional(),
  /** Base URL of the admin console, used in invite links. */
  ADMIN_WEB_URL: z.url().default('http://localhost:3002'),
  /** Number of reverse proxies in front of the API, so client IPs for rate limits are correct. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  STORAGE_BUCKET: z.string().min(3).max(63),
  STORAGE_PROVIDER: z.enum(STORAGE_PROVIDERS).default('local'),
  /** Directory for the local storage adapter, relative to the working directory. */
  STORAGE_LOCAL_DIR: z.string().min(1).default('.local-storage'),
  /** HMAC key that signs upload and download URLs. */
  STORAGE_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Public base URL of this API (with /v1), used to build signed storage URLs. */
  API_PUBLIC_URL: z.url().default('http://localhost:3000/v1'),
  MALWARE_SCANNER: z.enum(MALWARE_SCANNERS).default('mock'),
  CLAMAV_HOST: z.string().min(1).max(253).optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMAV_TLS: booleanFlag,
  /** Supabase project URL and service role key (server only; never sent to a client). */
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  DELIVERY_PARTNER: z.enum(DELIVERY_PARTNERS).default('none'),
  PSP_PROVIDER: z.enum(PSP_PROVIDERS).default('mock'),
  PSP_API_KEY: z.string().min(1).optional(),
  /** Stripe publishable key for the customer payment step (test mode only). */
  PSP_PUBLISHABLE_KEY: z.string().min(1).optional(),
  /** Base URL of the business portal, used for payout-account onboarding return links. */
  BUSINESS_WEB_URL: z.url().default('http://localhost:3001'),
  PSP_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters'),
  /** Signing secret of Stripe's separate Connect webhook endpoint (connected-account events). */
  PSP_CONNECT_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  MAPS_KEY: z.string().min(1).optional(),
  EMAIL_KEY: z.string().min(1).optional(),
  MOCK_PAYMENT_OUTCOMES: booleanFlag,
  /** Bearer token for GET /v1/metrics (Prometheus). Unset disables the endpoint; required in production. */
  METRICS_TOKEN: z.string().min(32, 'must be at least 32 characters').optional(),
};

type Issue = { path: string; message: string };

function productionIssues(env: Record<string, unknown>, shape: z.ZodRawShape): Issue[] {
  if (env['APP_ENV'] !== 'production') return [];
  const issues: Issue[] = [];
  if (env['PSP_PROVIDER'] === 'mock') {
    issues.push({
      path: 'PSP_PROVIDER',
      message: 'mock payment provider is not allowed in production',
    });
  }
  if (env['NOTIFY_PROVIDER'] === 'mock') {
    issues.push({
      path: 'NOTIFY_PROVIDER',
      message: 'mock email/SMS provider is not allowed in production',
    });
  }
  if (env['STORAGE_PROVIDER'] === 'local') {
    issues.push({
      path: 'STORAGE_PROVIDER',
      message: 'local file storage is not allowed in production',
    });
  }
  if (env['MALWARE_SCANNER'] === 'mock') {
    issues.push({
      path: 'MALWARE_SCANNER',
      message: 'mock malware scanner is not allowed in production',
    });
  }
  if (env['PUSH_PROVIDER'] === 'mock') {
    issues.push({
      path: 'PUSH_PROVIDER',
      message: 'mock push provider is not allowed in production',
    });
  }
  if (env['DELIVERY_PARTNER'] === 'mock') {
    issues.push({
      path: 'DELIVERY_PARTNER',
      message: 'mock delivery partner is not allowed in production',
    });
  }
  const publicUrl = env['API_PUBLIC_URL'];
  if (typeof publicUrl === 'string' && !publicUrl.startsWith('https://')) {
    issues.push({ path: 'API_PUBLIC_URL', message: 'must be https:// in production' });
  }
  if (env['MOCK_PAYMENT_OUTCOMES'] === true) {
    issues.push({
      path: 'MOCK_PAYMENT_OUTCOMES',
      message: 'development switch is not allowed in production',
    });
  }
  for (const key of ['MAPS_KEY', 'EMAIL_KEY', 'METRICS_TOKEN'] as const) {
    if (key in shape && env[key] === undefined) {
      issues.push({ path: key, message: 'is required in production' });
    }
  }
  for (const [key, value] of Object.entries(env)) {
    const text = Array.isArray(value) ? JSON.stringify(value) : value;
    if (typeof text === 'string' && text.includes(LOCAL_SECRET_MARKER)) {
      issues.push({ path: key, message: 'contains a committed example value' });
    }
  }
  for (const key of ['ADMIN_WEB_URL', 'BUSINESS_WEB_URL'] as const) {
    const url = env[key];
    if (key in shape && typeof url === 'string' && !url.startsWith('https://')) {
      issues.push({ path: key, message: 'must be https:// in production' });
    }
  }
  const origins = env['CORS_ORIGINS'];
  if (Array.isArray(origins) && origins.some((origin) => !String(origin).startsWith('https://'))) {
    issues.push({
      path: 'CORS_ORIGINS',
      message: 'must only contain https:// origins in production',
    });
  }
  return issues;
}

/** The fields of a Firebase service account that FCM needs; null when the value is not one. */
export function fcmServiceAccount(
  value: unknown,
): { projectId: string; clientEmail: string; privateKey: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const projectId = parsed['project_id'];
    const clientEmail = parsed['client_email'];
    const privateKey = parsed['private_key'];
    if (
      typeof projectId !== 'string' ||
      !/^[a-z0-9-]{4,40}$/.test(projectId) ||
      typeof clientEmail !== 'string' ||
      !clientEmail.includes('@') ||
      typeof privateKey !== 'string' ||
      !privateKey.includes('PRIVATE KEY')
    ) {
      return null;
    }
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

function withProductionGuards<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).superRefine((env, ctx) => {
    for (const issue of productionIssues(env as Record<string, unknown>, shape)) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
    const record = env as Record<string, unknown>;
    if ('PSP_PROVIDER' in record && record['PSP_PROVIDER'] !== 'mock' && !record['PSP_API_KEY']) {
      ctx.addIssue({
        code: 'custom',
        path: ['PSP_API_KEY'],
        message: 'is required for a real payment provider',
      });
    }
    if (record['STORAGE_PROVIDER'] === 'supabase') {
      for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
        if (!record[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required for Supabase storage',
          });
        }
      }
      const url = record['SUPABASE_URL'];
      if (typeof url === 'string' && !url.startsWith('https://') && record['APP_ENV'] !== 'local') {
        ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'must be https://' });
      }
    }
    if (record['MALWARE_SCANNER'] === 'clamav') {
      if (!record['CLAMAV_HOST']) {
        ctx.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'is required for ClamAV' });
      }
      if (record['APP_ENV'] === 'production' && record['CLAMAV_TLS'] !== true) {
        ctx.addIssue({
          code: 'custom',
          path: ['CLAMAV_TLS'],
          message: 'must be true in production (files are sent to the scanner)',
        });
      }
    }
    if (
      record['RATE_LIMIT_STORE'] === 'redis' &&
      'RATE_LIMIT_STORE' in shape &&
      !record['REDIS_URL']
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'is required when RATE_LIMIT_STORE=redis',
      });
    }
    if (record['SCHEDULERS'] === 'off' && record['APP_ENV'] !== 'test' && !record['CRON_SECRET']) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRON_SECRET'],
        message: 'is required when SCHEDULERS=off, or no background job would run',
      });
    }
    if (record['NOTIFY_PROVIDER'] === 'resend') {
      for (const key of ['EMAIL_KEY', 'EMAIL_FROM'] as const) {
        if (!record[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'is required for Resend' });
        }
      }
    }
    if (
      record['PUSH_PROVIDER'] === 'fcm' &&
      !fcmServiceAccount(record['FCM_SERVICE_ACCOUNT_JSON'])
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['FCM_SERVICE_ACCOUNT_JSON'],
        message:
          'must be a Firebase service account JSON with project_id, client_email and private_key',
      });
    }
    // Live payments are not approved (founder decision D5): only Stripe test-mode keys start.
    if (record['PSP_PROVIDER'] === 'stripe') {
      const key = record['PSP_API_KEY'];
      if (typeof key === 'string' && !STRIPE_TEST_SECRET_KEY.test(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['PSP_API_KEY'],
          message: 'must be a Stripe test-mode key (sk_test_ or rk_test_); live keys are refused',
        });
      }
      const publishable = record['PSP_PUBLISHABLE_KEY'];
      if (typeof publishable === 'string' && !STRIPE_TEST_PUBLISHABLE_KEY.test(publishable)) {
        ctx.addIssue({
          code: 'custom',
          path: ['PSP_PUBLISHABLE_KEY'],
          message: 'must be a Stripe test-mode key (pk_test_); live keys are refused',
        });
      }
    }
  });
}

export const apiEnvSchema = withProductionGuards(apiShape);
export const workerEnvSchema = withProductionGuards(baseShape);
export const databaseEnvSchema = withProductionGuards({
  APP_ENV: baseShape.APP_ENV,
  DATABASE_URL: baseShape.DATABASE_URL,
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly Issue[];

  constructor(issues: Issue[]) {
    super(`Invalid environment:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Parses an environment source (usually process.env). Empty strings are treated as unset,
 * which matches how .env files are commonly written.
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined>,
): z.infer<S> {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;
  throw new EnvValidationError(
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      // Zod messages describe the rule, not the input, so no value is echoed here.
      message: issue.message,
    })),
  );
}
