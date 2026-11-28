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

/** Payment providers with an adapter in this codebase. A real provider is added in phase 5. */
export const PSP_PROVIDERS = ['mock'] as const;

/** Email/SMS providers with an adapter. Only the mock exists until a provider is chosen (ADR-0007). */
export const NOTIFY_PROVIDERS = ['mock'] as const;

/**
 * Object storage adapters. `local` keeps files on disk and serves HMAC-signed URLs from the API
 * itself, so uploads behave like signed S3 URLs locally. A real S3-compatible adapter is required
 * before production (ADR-0012), so production refuses `local`.
 */
export const STORAGE_PROVIDERS = ['local'] as const;

/** Malware scanners. The mock flags the EICAR test file; production refuses it (ADR-0012). */
export const MALWARE_SCANNERS = ['mock'] as const;

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
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: commaList,
  JWT_KEYS: jwtKeysSchema,
  /** HMAC key for one-time codes, so a database leak does not reveal live codes. */
  OTP_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Key material for encrypting admin TOTP secrets at rest (HKDF-derived AES-256-GCM key). */
  MFA_ENCRYPTION_KEY: z.string().min(32, 'must be at least 32 characters'),
  NOTIFY_PROVIDER: z.enum(NOTIFY_PROVIDERS).default('mock'),
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
  PSP_PROVIDER: z.enum(PSP_PROVIDERS).default('mock'),
  PSP_API_KEY: z.string().min(1).optional(),
  PSP_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters'),
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
  const adminUrl = env['ADMIN_WEB_URL'];
  if (typeof adminUrl === 'string' && !adminUrl.startsWith('https://')) {
    issues.push({ path: 'ADMIN_WEB_URL', message: 'must be https:// in production' });
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
