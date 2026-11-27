// Creates the first superadmin as an invitation and prints the one-time link to this terminal.
// Works in any environment, but only while no superadmin exists, so it cannot become a back door.
// Usage: pnpm --filter @jays/api admin:bootstrap -- ops@company.example "Display Name"
import { createDb } from '@jays/db';
import pg from 'pg';
import { randomToken, sha256 } from '../src/auth/crypto.js';
import { ADMIN_INVITE_TTL_SECONDS } from '../src/auth/policy.js';
import { scriptEnv } from './script-env.js';

const env = scriptEnv();
const [email, displayName] = process.argv.slice(2).filter((a) => a !== '--');
if (!email || !displayName) {
  console.error('usage: admin:bootstrap -- <email> "<display name>"');
  process.exit(1);
}
const db = createDb(new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 }));
try {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ADMIN_INVITE_TTL_SECONDS * 1000);
  await db.transaction().execute(async (trx) => {
    await trx
      .selectFrom('admin_roles')
      .select('id')
      .where('role', '=', 'superadmin')
      .forUpdate()
      .execute();
    const existing = await trx
      .selectFrom('admin_roles')
      .select('id')
      .where('role', '=', 'superadmin')
      .executeTakeFirst();
    if (existing)
      throw new Error('A superadmin already exists. Invite further admins from the admin console.');
    const admin = await trx
      .insertInto('admin_accounts')
      .values({
        email: email.toLowerCase(),
        display_name: displayName,
        status: 'invited',
        invite_token_hash: sha256(token),
        invite_expires_at: expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('admin_roles')
      .values({ admin_id: admin.id, role: 'superadmin' })
      .execute();
    await trx
      .insertInto('audit_logs')
      .values({
        actor_type: 'system',
        action: 'admin.bootstrapped',
        target_type: 'admin_account',
        target_id: admin.id,
        reason: 'First superadmin bootstrap',
      })
      .execute();
  });
  const link = new URL('/invite', env.ADMIN_WEB_URL);
  link.searchParams.set('token', token);
  console.log(
    `Invitation for ${email} (expires ${expiresAt.toISOString()}). Open once, then set a password and authenticator:`,
  );
  console.log(link.toString());
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
