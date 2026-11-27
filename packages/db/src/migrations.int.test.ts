import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, MigrationError, runMigrations, type Migration } from './migrations.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required for integration tests (run `pnpm dev:deps`).');

const client = new pg.Client({ connectionString: url });
const scratch = `it_${process.pid}_${Date.now()}`;

beforeAll(async () => {
  await client.connect();
  await runMigrations(client, await loadMigrations());
  await client.query(`CREATE SCHEMA ${scratch}`);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`);
  await client.end();
});

describe('baseline migration', () => {
  it('installs the required extensions', async () => {
    const { rows } = await client.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname`,
      [['btree_gist', 'citext', 'pgcrypto']],
    );
    expect(rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext', 'pgcrypto']);
  });

  it('is idempotent', async () => {
    expect(await runMigrations(client, await loadMigrations())).toEqual([]);
  });

  // Proves the mechanism phase 4 relies on (docs/06-architecture-data.md invariants): the database,
  // not application code, rejects overlapping active intervals for the same staff member.
  it('supports a staff-overlap exclusion constraint that ignores canceled bookings', async () => {
    await client.query(`CREATE TABLE ${scratch}.slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL,
      occupied tstzrange NOT NULL,
      status text NOT NULL,
      EXCLUDE USING gist (staff_id WITH =, occupied WITH &&)
        WHERE (status IN ('held', 'confirmed', 'checked_in'))
    )`);
    const staff = '00000000-0000-4000-8000-000000000001';
    const insert = (range: string, status: string) =>
      client.query(
        `INSERT INTO ${scratch}.slots (staff_id, occupied, status) VALUES ($1, $2, $3)`,
        [staff, range, status],
      );
    await insert('[2027-01-02 06:00Z,2027-01-02 07:00Z)', 'confirmed');
    // Back-to-back is allowed with half-open ranges.
    await insert('[2027-01-02 07:00Z,2027-01-02 07:30Z)', 'held');
    // Overlap is rejected with exclusion_violation (23P01).
    await expect(insert('[2027-01-02 06:30Z,2027-01-02 07:15Z)', 'held')).rejects.toMatchObject({
      code: '23P01',
    });
    // Canceled rows do not occupy the interval.
    await insert('[2027-01-02 06:30Z,2027-01-02 07:15Z)', 'canceled');
  });
});

describe('runner safety', () => {
  const table = () => `${scratch}.migrations_probe`;
  const m = (version: number, sql: string): Migration => ({
    version,
    name: `probe${version}`,
    sql,
    checksum: `sum-${sql}`,
  });

  it('refuses edited migrations and rolls back failures', async () => {
    expect(await runMigrations(client, [m(1, 'SELECT 1')], { table: table() })).toEqual([1]);
    await expect(runMigrations(client, [m(1, 'SELECT 2')], { table: table() })).rejects.toThrow(
      MigrationError,
    );
    await expect(
      runMigrations(
        client,
        [m(1, 'SELECT 1'), m(2, `CREATE TABLE ${scratch}.half (id int); SELECT 1/0`)],
        { table: table() },
      ),
    ).rejects.toMatchObject({ code: '22012' });
    const { rows } = await client.query(`SELECT to_regclass('${scratch}.half') AS t`);
    expect(rows[0].t).toBeNull();
  });

  it('refuses a database that is ahead of the code', async () => {
    await expect(runMigrations(client, [], { table: table() })).rejects.toThrow(/missing on disk/);
  });
});
