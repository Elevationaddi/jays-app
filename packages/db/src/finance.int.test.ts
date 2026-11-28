import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from './migrations.js';

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

/** Inserts a platform-only transaction (no business accounts) with the given entries. */
async function transaction(entries: { account: string; debit?: number; credit?: number }[]) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions (kind, source_type, source_id, occurred_at)
     VALUES ('late_capture', 'payment', $1, now()) RETURNING id`,
    [randomUUID()],
  );
  const id = rows[0]?.id as string;
  for (const e of entries) {
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account, debit_fils, credit_fils)
       VALUES ($1, $2, $3, $4)`,
      [id, e.account, e.debit ?? 0, e.credit ?? 0],
    );
  }
  return id;
}

// docs/06-architecture-data.md invariants (T06): the database itself keeps the ledger honest.
describe('ledger invariants', () => {
  it('commits a balanced transaction', async () => {
    await client.query('BEGIN');
    const id = await transaction([
      { account: 'psp_clearing', debit: 1_000 },
      { account: 'unallocated_receipts', credit: 1_000 },
    ]);
    await client.query('COMMIT');
    const { rows } = await client.query(
      'SELECT count(*)::int AS n FROM ledger_entries WHERE transaction_id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ n: 2 });
  });

  it('refuses to commit an unbalanced transaction', async () => {
    await client.query('BEGIN');
    await transaction([
      { account: 'psp_clearing', debit: 1_000 },
      { account: 'unallocated_receipts', credit: 999 },
    ]);
    await expect(client.query('COMMIT')).rejects.toThrow(/balance/i);
  });

  it('refuses an entry that is both debit and credit, or neither', async () => {
    await client.query('BEGIN');
    await expect(
      transaction([{ account: 'psp_clearing', debit: 10, credit: 10 }]),
    ).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK');
  });

  it('requires a business on business accounts only', async () => {
    await client.query('BEGIN');
    await expect(transaction([{ account: 'merchant_payable', credit: 10 }])).rejects.toMatchObject({
      code: '23514',
    });
    await client.query('ROLLBACK');
  });

  it('keeps transactions and entries append-only', async () => {
    await client.query('BEGIN');
    const id = await transaction([
      { account: 'psp_clearing', debit: 500 },
      { account: 'unallocated_receipts', credit: 500 },
    ]);
    await client.query('COMMIT');
    await expect(
      client.query('UPDATE ledger_entries SET debit_fils = 1 WHERE transaction_id = $1', [id]),
    ).rejects.toThrow();
    await expect(
      client.query('DELETE FROM ledger_entries WHERE transaction_id = $1', [id]),
    ).rejects.toThrow();
    await expect(
      client.query(`UPDATE ledger_transactions SET memo = 'x' WHERE id = $1`, [id]),
    ).rejects.toThrow();
  });

  it('records each source event once', async () => {
    const source = randomUUID();
    const insert = () =>
      client.query(
        `INSERT INTO ledger_transactions (kind, source_type, source_id, occurred_at)
         VALUES ('refund', 'refund', $1, now())`,
        [source],
      );
    await client.query('BEGIN');
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK');
  });
});

describe('fee rules', () => {
  it('are append-only', async () => {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO fee_rules (mode, commission_bps, effective_at, reason)
       VALUES ('shop', 1000, now() + interval '100 years' + random() * interval '1 day',
               'Fictional test rule') RETURNING id`,
    );
    await expect(
      client.query('UPDATE fee_rules SET commission_bps = 0 WHERE id = $1', [rows[0]?.id]),
    ).rejects.toThrow();
    await client.query('ROLLBACK');
  });
});
