import { Kysely, PostgresDialect } from 'kysely';
import type pg from 'pg';
import type { Database } from './schema.js';

export type Db = Kysely<Database>;

/** Builds a Kysely instance on an existing pool. The caller owns the pool's lifecycle. */
export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
