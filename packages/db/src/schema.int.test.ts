import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from './migrations.js';
import { SCHEMA_COLUMNS } from './schema.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required for integration tests (run `pnpm dev:deps`).');
const client = new pg.Client({ connectionString: url });

beforeAll(async () => {
  await client.connect();
  await runMigrations(client, await loadMigrations());
});
afterAll(async () => {
  await client.end();
});

describe('Kysely types match the migrated schema', () => {
  it('declares exactly the tables and columns that exist', async () => {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
        ORDER BY table_name, ordinal_position`,
    );
    const live: Record<string, string[]> = {};
    for (const row of rows) (live[row.table_name] ??= []).push(row.column_name);
    const declared = Object.fromEntries(
      Object.entries(SCHEMA_COLUMNS).map(([table, columns]) => [table, [...columns]]),
    );
    expect(live).toEqual(declared);
  });
});

describe('identity invariants enforced by the database', () => {
  const hash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
  const insertUser = (
    email: string | null,
    phone: string | null,
    status = 'pending_verification',
  ) =>
    client.query(
      `INSERT INTO users (email, phone, password_hash, status, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, $4, 'test', now()) RETURNING id`,
      [email, phone, hash, status],
    );
  const unique = `${process.pid}-${Date.now()}`;

  it('needs a contact, refuses an unverified active user, and compares email case-insensitively', async () => {
    await expect(insertUser(null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(insertUser(`a-${unique}@example.test`, null, 'active')).rejects.toMatchObject({
      code: '23514',
    });
    await insertUser(`Case-${unique}@Example.test`, null);
    await expect(insertUser(`case-${unique}@example.test`, null)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('refuses unknown business permissions, including anything resembling platform admin', async () => {
    const user = await insertUser(`m-${unique}@example.test`, null);
    const userId = user.rows[0].id as string;
    const biz = await client.query(
      `INSERT INTO businesses (display_name, created_by) VALUES ($1, $2) RETURNING id`,
      [JSON.stringify({ en: 'Test', ar: 'تجربة' }), userId],
    );
    const businessId = biz.rows[0].id as string;
    await expect(
      client.query(
        `INSERT INTO memberships (business_id, user_id, permissions, status) VALUES ($1, $2, $3, 'invited')`,
        [businessId, userId, ['owner', 'superadmin']],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(`INSERT INTO businesses (display_name, created_by) VALUES ($1, $2)`, [
        JSON.stringify({ en: 'Only English' }),
        userId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps the audit log append-only', async () => {
    const { rows } = await client.query(
      `INSERT INTO audit_logs (actor_type, action, target_type) VALUES ('system', 'test.append_only', 'test') RETURNING id`,
    );
    await expect(
      client.query(`UPDATE audit_logs SET reason = 'x' WHERE id = $1`, [rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      client.query(`DELETE FROM audit_logs WHERE id = $1`, [rows[0].id]),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses an active admin without MFA', async () => {
    await expect(
      client.query(
        `INSERT INTO admin_accounts (email, display_name, password_hash, status) VALUES ($1, 'X', $2, 'active')`,
        [`admin-${unique}@example.test`, hash],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('merchant onboarding invariants enforced by the database (phase 2)', () => {
  const hash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
  const unique = `p2-${process.pid}-${Date.now()}`;
  let userId: string;
  const newBusiness = async () =>
    (
      await client.query(
        `INSERT INTO businesses (display_name, created_by) VALUES ($1, $2) RETURNING id`,
        [JSON.stringify({ en: 'Test', ar: 'تجربة' }), userId],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, terms_version, terms_accepted_at)
       VALUES ($1, $2, 'test', now()) RETURNING id`,
      [`owner-${unique}@example.test`, hash],
    );
    userId = rows[0].id as string;
  });

  it('refuses to submit or approve a business with an incomplete legal profile', async () => {
    const id = await newBusiness();
    for (const status of ['submitted', 'approved']) {
      await expect(
        client.query(`UPDATE businesses SET status = $2, submitted_at = now() WHERE id = $1`, [
          id,
          status,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('requires a reason to reject, and a reason to suspend', async () => {
    const id = await newBusiness();
    await client.query(
      `UPDATE businesses SET legal_name = 'Fictional LLC', trade_license_number = 'CN-1234567',
         license_authority = 'Fictional Authority', license_expiry = '2099-01-01',
         address_emirate_code = 'DXB', address_area = 'Area', address_street = 'Street',
         address_building = 'Building', agreement_version = 'v', agreement_accepted_at = now(),
         agreement_accepted_by = $2, submitted_at = now(), status = 'under_review'
       WHERE id = $1`,
      [id, userId],
    );
    await expect(
      client.query(`UPDATE businesses SET status = 'rejected', reviewed_at = now() WHERE id = $1`, [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await client.query(
      `UPDATE businesses SET status = 'approved', reviewed_at = now() WHERE id = $1`,
      [id],
    );
    await expect(
      client.query(
        `UPDATE businesses SET status = 'suspended', suspended_at = now() WHERE id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps category trees within one mode, three levels deep, and unmovable', async () => {
    const root = await client.query(
      `INSERT INTO categories (mode, slug, name) VALUES ('shop', $1, $2) RETURNING id, depth`,
      [`root-${unique}`, JSON.stringify({ en: 'Root', ar: 'جذر' })],
    );
    const rootId = root.rows[0].id as string;
    expect(root.rows[0].depth).toBe(0);
    await expect(
      client.query(
        `INSERT INTO categories (parent_id, mode, slug, name) VALUES ($1, 'services', $2, $3)`,
        [rootId, `x-${unique}`, JSON.stringify({ en: 'X', ar: 'س' })],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    let parent = rootId;
    for (const level of [1, 2]) {
      const { rows } = await client.query(
        `INSERT INTO categories (parent_id, mode, slug, name) VALUES ($1, 'shop', $2, $3) RETURNING id, depth`,
        [parent, `l${level}-${unique}`, JSON.stringify({ en: 'L', ar: 'م' })],
      );
      expect(rows[0].depth).toBe(level);
      parent = rows[0].id as string;
    }
    await expect(
      client.query(
        `INSERT INTO categories (parent_id, mode, slug, name) VALUES ($1, 'shop', $2, $3)`,
        [parent, `l3-${unique}`, JSON.stringify({ en: 'L', ar: 'م' })],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      client.query(`UPDATE categories SET parent_id = NULL WHERE id = $1`, [parent]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it("refuses a storefront that points at another business's media", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const media = await client.query(
      `INSERT INTO media (business_id, purpose, object_key, content_type, declared_size_bytes, upload_expires_at, created_by)
       VALUES ($1, 'storefront_logo', $2, 'image/png', 100, now(), $3) RETURNING id`,
      [a, `media/${unique}/logo.png`, userId],
    );
    await expect(
      client.query(`INSERT INTO storefronts (business_id, logo_media_id) VALUES ($1, $2)`, [
        b,
        media.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    await client.query(`INSERT INTO storefronts (business_id, logo_media_id) VALUES ($1, $2)`, [
      a,
      media.rows[0].id,
    ]);
  });

  it('keeps private documents under the private prefix', async () => {
    const id = await newBusiness();
    await expect(
      client.query(
        `INSERT INTO verification_documents (business_id, kind, object_key, file_name, content_type, declared_size_bytes, upload_expires_at, uploaded_by)
         VALUES ($1, 'trade_license', $2, 'licence.pdf', 'application/pdf', 100, now(), $3)`,
        [id, `media/${unique}.pdf`, userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
