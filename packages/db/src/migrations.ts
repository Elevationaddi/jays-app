import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export interface Migration {
  /** e.g. 1 for 0001_extensions.sql */
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Parses migration file names into an ordered list, rejecting gaps and duplicates. */
export function orderMigrations(files: { file: string; sql: string }[]): Migration[] {
  const migrations = files
    .filter(({ file }) => file.endsWith('.sql'))
    .map(({ file, sql }) => {
      const match = FILE_PATTERN.exec(file);
      if (!match) throw new MigrationError(`Bad migration file name: ${file} (want 0001_name.sql)`);
      return { version: Number(match[1]), name: match[2] as string, sql, checksum: checksum(sql) };
    })
    .sort((a, b) => a.version - b.version);
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        `Migration versions must be contiguous from 0001; found ${String(migration.version).padStart(4, '0')} at position ${index + 1}`,
      );
    }
  });
  return migrations;
}

export async function loadMigrations(dir = DEFAULT_MIGRATIONS_DIR): Promise<Migration[]> {
  const files = await readdir(dir);
  return orderMigrations(
    await Promise.all(
      files.map(async (file) => ({ file, sql: await readFile(`${dir}/${file}`, 'utf8') })),
    ),
  );
}

export interface RunOptions {
  /** Tracking table, schema-qualified if needed. Default: public.schema_migrations */
  table?: string;
  log?: (message: string) => void;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
// Arbitrary constant so concurrent deploys serialize instead of racing.
const ADVISORY_LOCK_KEY = 728_431_001;

/**
 * Applies pending migrations, each in its own transaction, under a session advisory lock.
 * Already-applied migrations must be byte-identical (checksum) to the files on disk.
 * Returns the versions applied by this call.
 */
export async function runMigrations(
  client: pg.ClientBase,
  migrations: Migration[],
  { table = 'public.schema_migrations', log = () => undefined }: RunOptions = {},
): Promise<number[]> {
  if (!IDENTIFIER.test(table)) throw new MigrationError(`Invalid tracking table name: ${table}`);
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${table} (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: number; checksum: string }>(
      `SELECT version, checksum FROM ${table} ORDER BY version`,
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));
    for (const [version] of applied) {
      if (!migrations.some((m) => m.version === version)) {
        throw new MigrationError(`Database has migration ${version} that is missing on disk`);
      }
    }
    const done: number[] = [];
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new MigrationError(
            `Migration ${migration.version}_${migration.name} was changed after it was applied. Add a new migration instead.`,
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(`INSERT INTO ${table} (version, name, checksum) VALUES ($1, $2, $3)`, [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      log(`applied ${String(migration.version).padStart(4, '0')}_${migration.name}`);
      done.push(migration.version);
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}
