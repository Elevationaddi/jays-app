// Prints the current authenticator code for a seeded local admin. Local/test only.
// Usage: pnpm --filter @jays/api totp superadmin@admin.example.test
import { createDb } from '@jays/db';
import pg from 'pg';
import { SecretBox } from '../src/auth/crypto.js';
import { totpAt } from '../src/auth/totp.js';
import { assertLocal, scriptEnv } from './script-env.js';

const env = scriptEnv();
assertLocal(env, 'The TOTP helper');
const email = process.argv[2];
if (!email) {
  console.error('usage: totp <admin email>');
  process.exit(1);
}
const db = createDb(new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 }));
try {
  const admin = await db
    .selectFrom('admin_accounts')
    .select('mfa_secret_enc')
    .where('email', '=', email)
    .executeTakeFirst();
  if (!admin?.mfa_secret_enc) {
    console.error('no enrolled admin with that email');
    process.exitCode = 1;
  } else {
    console.log(
      totpAt(new SecretBox(env.MFA_ENCRYPTION_KEY).open(admin.mfa_secret_enc), new Date()),
    );
  }
} finally {
  await db.destroy();
}
