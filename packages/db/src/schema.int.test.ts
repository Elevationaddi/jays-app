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
