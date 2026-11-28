#!/usr/bin/env node
// Prints fresh random values for the staging (or production) secrets that JAYS generates itself.
// Run it on your own computer: `node scripts/staging/generate-secrets.mjs [staging|production]`.
// The values are printed to this terminal only. Paste each one into Vercel's environment variables
// (marked Sensitive) and nowhere else: never into a chat, an email, a document or the repository.
import { randomBytes } from 'node:crypto';

const target = process.argv[2] ?? 'staging';
if (!['staging', 'production'].includes(target)) {
  console.error('Usage: node scripts/staging/generate-secrets.mjs [staging|production]');
  process.exit(1);
}
const kid = target === 'staging' ? 'stg1' : 'prd1';
const value = () => randomBytes(32).toString('base64url'); // 43 characters, 256 bits

const secrets = {
  JWT_KEYS: `${kid}:${value()}`,
  OTP_SECRET: value(),
  MFA_ENCRYPTION_KEY: value(),
  STORAGE_SIGNING_SECRET: value(),
  METRICS_TOKEN: value(),
  CRON_SECRET: value(),
  ...(target === 'staging' ? { STAGING_ACCESS_TOKEN: value() } : {}),
};

console.log(`# New ${target} secrets. Each run prints different values.`);
console.log('# Put them in Vercel only. Do not save this output in a file or share it.\n');
for (const [name, secret] of Object.entries(secrets)) console.log(`${name}=${secret}`);
if (target === 'staging') {
  console.log(
    '\n# STAGING_ACCESS_TOKEN goes into jays-staging-api, jays-staging-business, jays-staging-admin',
  );
  console.log('# and (as EXPO_PUBLIC_STAGING_ACCESS_TOKEN) jays-staging-web.');
}
