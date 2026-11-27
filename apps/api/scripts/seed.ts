// Idempotent local seed: fictional customers, business owners and staff, and one admin per role.
// Usage: pnpm db:seed   (needs DATABASE_URL and MFA_ENCRYPTION_KEY; refuses outside local/test)
import { randomUUID } from 'node:crypto';
import { createDb, type Db } from '@jays/db';
import { MERCHANT_AGREEMENT_VERSION } from '@jays/domain';
import pg from 'pg';
import { LocalObjectStorage } from '../src/storage/local-storage.js';
import { fictionalPdf, renderPng } from '../src/testing/png.js';
import { hashPassword, SecretBox } from '../src/auth/crypto.js';
import { TERMS_VERSION } from '../src/auth/policy.js';
import { generateTotpSecret } from '../src/auth/totp.js';
import {
  SEED_ADMIN_ROLES,
  SEED_BRANDS,
  SEED_BUSINESSES,
  SEED_PASSWORD,
  SEED_SUBCATEGORIES,
  SEED_USERS,
  type SeedBusiness,
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
// Files go straight into the local storage adapter's directory (signing is not needed to write).
const storage = new LocalObjectStorage(env.STORAGE_LOCAL_DIR, 'seed-writes-only', 'http://unused');

/** Fills legal profile, documents, storefront and review state for one seeded business. */
async function seedOnboarding(
  trx: Db,
  businessId: string,
  ownerId: string,
  reviewerId: string,
  b: SeedBusiness,
): Promise<void> {
  const o = b.onboarding;
  const existing = await trx
    .selectFrom('businesses')
    .select('legal_name')
    .where('id', '=', businessId)
    .executeTakeFirstOrThrow();
  if (o.status === 'draft' || existing.legal_name !== null) return; // already seeded

  const docKey = `private/${businessId}/${randomUUID()}.pdf`;
  const pdf = fictionalPdf(`FICTIONAL trade licence ${o.licenseNumber} - local seed data`);
  await storage.put(docKey, pdf, 'application/pdf');
  await trx
    .insertInto('verification_documents')
    .values({
      business_id: businessId,
      kind: 'trade_license',
      object_key: docKey,
      file_name: `trade-licence-${o.licenseNumber}.pdf`,
      content_type: 'application/pdf',
      declared_size_bytes: pdf.length,
      size_bytes: pdf.length,
      sha256: (await import('node:crypto')).createHash('sha256').update(pdf).digest('hex'),
      status: 'clean',
      upload_expires_at: now,
      uploaded_at: now,
      uploaded_by: ownerId,
    })
    .execute();

  const media: Record<'storefront_logo' | 'storefront_banner', string> = {
    storefront_logo: '',
    storefront_banner: '',
  };
  for (const [purpose, width, height] of [
    ['storefront_logo', 400, 400],
    ['storefront_banner', 1500, 500],
  ] as const) {
    const png = renderPng(width, height, {
      from: o.colors.from,
      to: o.colors.to,
      ...(purpose === 'storefront_logo' ? { disc: o.colors.disc } : {}),
    });
    const key = `media/${businessId}/${randomUUID()}.png`;
    await storage.put(key, png, 'image/png');
    const row = await trx
      .insertInto('media')
      .values({
        business_id: businessId,
        purpose,
        object_key: key,
        content_type: 'image/png',
        declared_size_bytes: png.length,
        size_bytes: png.length,
        width,
        height,
        status: 'ready',
        upload_expires_at: now,
        uploaded_at: now,
        created_by: ownerId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    media[purpose] = row.id;
  }

  const approved = o.status === 'approved';
  const name = JSON.stringify(o.storefront.name);
  const description = JSON.stringify(o.storefront.description);
  await trx
    .insertInto('storefronts')
    .values({
      business_id: businessId,
      name,
      description,
      logo_media_id: media.storefront_logo,
      banner_media_id: media.storefront_banner,
      ...(approved
        ? {
            live_name: name,
            live_description: description,
            live_logo_media_id: media.storefront_logo,
            live_banner_media_id: media.storefront_banner,
            published_at: now,
          }
        : {}),
    })
    .execute();
  await trx
    .updateTable('businesses')
    .set({
      legal_name: o.legalName,
      trade_license_number: o.licenseNumber,
      license_authority: 'Fictional Department of Economy (seed)',
      license_expiry: '2099-12-31',
      tax_registered: false,
      address_emirate_code: o.emirate,
      address_area: o.area,
      address_street: '1 Example Street',
      address_building: 'Fictional Building',
      agreement_version: MERCHANT_AGREEMENT_VERSION,
      agreement_accepted_at: now,
      agreement_accepted_by: ownerId,
      submitted_at: now,
      status: o.status,
      ...(approved ? { reviewed_at: now, reviewed_by: reviewerId } : {}),
    })
    .where('id', '=', businessId)
    .execute();
  await trx
    .updateTable('business_modes')
    .set(
      approved
        ? { status: 'active', submitted_at: now, reviewed_at: now }
        : { status: 'pending_review', submitted_at: now },
    )
    .where('business_id', '=', businessId)
    .execute();
  await trx
    .insertInto('audit_logs')
    .values({
      actor_type: 'system',
      action: 'business.seeded',
      target_type: 'business',
      target_id: businessId,
      business_id: businessId,
      redacted_diff: JSON.stringify({ status: o.status }),
    })
    .execute();
}

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

    const adminIds = new Map<string, string>();
    for (const role of SEED_ADMIN_ROLES) {
      const email = seedAdminEmail(role);
      const existing = await trx
        .selectFrom('admin_accounts')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
      if (existing) {
        adminIds.set(role, existing.id);
        continue;
      }
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
      adminIds.set(role, admin.id);
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
      await seedOnboarding(trx, business.id, ownerId, adminIds.get('superadmin') as string, b);
    }

    for (const sub of SEED_SUBCATEGORIES) {
      const parent = await trx
        .selectFrom('categories')
        .select('id')
        .where('mode', '=', sub.mode)
        .where('slug', '=', sub.parent)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('categories')
        .values({
          mode: sub.mode,
          parent_id: parent.id,
          slug: sub.slug,
          name: JSON.stringify(sub.name),
        })
        .onConflict((oc) => oc.columns(['mode', 'slug']).doNothing())
        .execute();
    }
    for (const brand of SEED_BRANDS) {
      await trx
        .insertInto('brands')
        .values({
          slug: brand.slug,
          name: JSON.stringify(brand.name),
          created_by: adminIds.get('superadmin') ?? null,
        })
        .onConflict((oc) => oc.column('slug').doNothing())
        .execute();
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
