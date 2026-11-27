import { describe, expect, it } from 'vitest';
import { checksum, loadMigrations, MigrationError, orderMigrations } from './migrations.js';

describe('orderMigrations', () => {
  it('orders by version and ignores non-sql files', () => {
    const result = orderMigrations([
      { file: '0002_b.sql', sql: 'select 2' },
      { file: 'README.md', sql: '' },
      { file: '0001_a.sql', sql: 'select 1' },
    ]);
    expect(result.map((m) => m.name)).toEqual(['a', 'b']);
    expect(result[0]?.checksum).toBe(checksum('select 1'));
  });

  it('rejects gaps, duplicates and bad names', () => {
    expect(() => orderMigrations([{ file: '0002_b.sql', sql: '' }])).toThrow(MigrationError);
    expect(() =>
      orderMigrations([
        { file: '0001_a.sql', sql: '' },
        { file: '0001_b.sql', sql: '' },
      ]),
    ).toThrow(MigrationError);
    expect(() => orderMigrations([{ file: '1_Bad.sql', sql: '' }])).toThrow(MigrationError);
  });
});

describe('repository migrations', () => {
  it('load cleanly from disk', async () => {
    const migrations = await loadMigrations();
    expect(migrations[0]?.name).toBe('extensions');
  });
});
