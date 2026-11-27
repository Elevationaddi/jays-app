import { z } from 'zod';
import { APP_ENVS, parseEnv } from '@jays/config';

export const scriptEnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default('local'),
  DATABASE_URL: z.string().min(1),
  MFA_ENCRYPTION_KEY: z.string().min(32),
  ADMIN_WEB_URL: z.url().default('http://localhost:3002'),
});

export function scriptEnv() {
  return parseEnv(scriptEnvSchema, process.env);
}

/** Seeding and code helpers are for local machines and CI only. */
export function assertLocal(env: { APP_ENV: string }, what: string): void {
  if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
    console.error(`${what} only runs with APP_ENV=local or test (got ${env.APP_ENV}). Refusing.`);
    process.exit(1);
  }
}
