// Idempotent local seed: fictional customers, business owners and staff, and one admin per role.
// Usage: pnpm db:seed   (needs DATABASE_URL and MFA_ENCRYPTION_KEY; refuses outside local/test)
import { createDb } from '@jays/db';
import pg from 'pg';
import { hashPassword, SecretBox } from '../src/auth/crypto.js';
import { TERMS_VERSION } from '../src/auth/policy.js';
import { generateTotpSecret } from '../src/auth/totp.js';
import {
  SEED_ADMIN_ROLES,
  SEED_BUSINESSES,
  SEED_PASSWORD,
  SEED_USERS,
  seedAdminEmail,
} from './seed-data.js';
import { assertLocal, scriptEnv } from './script-env.js';

const env = scriptEnv();
assertLocal(env, 'Seeding');
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
const db = createDb(pool);
const box = new SecretBox(env.MFA_ENCRYPTION_KEY);
const passwordHash = await hashPassword(SEED_PASSWORD);
const now = new Date();

try {
  await db.transaction().execute(async (trx) => {
    const userIds = new Map<string, string>();
    for (const u of SEED_USERS) {
      const existing = await trx
        .selectFrom('users')
        .select('id')
        .where(u.email ? 'email' : 'phone', '=', (u.email ?? u.phone) as string)
        .executeTakeFirst();
      const id =
        existing?.id ??
        (
          await trx
            .insertInto('users')
            .values({
              email: u.email ?? null,
              email_verified_at: u.email ? now : null,
              phone: u.phone ?? null,
              phone_verified_at: u.phone ? now : null,
              password_hash: passwordHash,
              status: 'active',
              display_name: u.displayName,
              locale: u.locale,
              emirate_code: u.emirate,
              terms_version: TERMS_VERSION,
              terms_accepted_at: now,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      userIds.set(u.key, id);
    }

    for (const b of SEED_BUSINESSES) {
      const ownerId = userIds.get(b.owner) as string;
      let business = await trx
        .selectFrom('businesses')
        .select('id')
        .where('created_by', '=', ownerId)
        .where(({ eb, ref }) => eb(ref('display_name', '->>').key('en'), '=', b.displayName.en))
        .executeTakeFirst();
      business ??= await trx
        .insertInto('businesses')
        .values({ display_name: JSON.stringify(b.displayName), created_by: ownerId })
        .returning('id')
        .executeTakeFirstOrThrow();
      const members = [{ user: b.owner, permissions: ['owner'] }, ...b.staff];
      for (const m of members) {
        await trx
          .insertInto('memberships')
          .values({
            business_id: business.id,
            user_id: userIds.get(m.user) as string,
            permissions: m.permissions,
            status: 'active',
            accepted_at: now,
            invited_by: m.user === b.owner ? null : ownerId,
          })
          .onConflict((oc) => oc.columns(['business_id', 'user_id']).doNothing())
          .execute();
      }
      for (const mode of b.modes) {
        await trx
          .insertInto('business_modes')
          .values({ business_id: business.id, mode, activated_by: ownerId })
          .onConflict((oc) => oc.columns(['business_id', 'mode']).doNothing())
          .execute();
      }
    }

    for (const role of SEED_ADMIN_ROLES) {
      const email = seedAdminEmail(role);
      const existing = await trx
        .selectFrom('admin_accounts')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
      if (existing) continue;
      const admin = await trx
        .insertInto('admin_accounts')
        .values({
          email,
          display_name: `Local ${role}`,
          password_hash: passwordHash,
          status: 'active',
          mfa_secret_enc: box.seal(generateTotpSecret()),
          mfa_enabled_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('admin_roles').values({ admin_id: admin.id, role }).execute();
    }
  });
  console.log(
    `seeded ${SEED_USERS.length} users, ${SEED_BUSINESSES.length} businesses, ${SEED_ADMIN_ROLES.length} admins`,
  );
  console.log(`password for every seeded account: ${SEED_PASSWORD}`);
  console.log(
    'admin authenticator codes: pnpm --filter @jays/api totp superadmin@admin.example.test',
  );
} finally {
  await db.destroy();
}
