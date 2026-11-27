import { HttpStatus } from '@nestjs/common';
import { type Expression, type SqlBool, sql } from 'kysely';
import { z } from 'zod';
import { ApiError } from './error.filter.js';

/**
 * Keyset pagination on (created_at, id). The cursor carries the timestamp as text with full
 * microsecond precision, because JavaScript dates would drop it and repeat rows.
 */
export const listQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface CursorKey {
  ts: string;
  id: string;
}

const cursorShape = z.tuple([z.string().regex(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/), z.uuid()]);

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([key.ts, key.id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorKey | undefined {
  if (cursor === undefined) return undefined;
  try {
    const [ts, id] = cursorShape.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    return { ts, id };
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'The cursor is not valid.', {
      cursor: ['is not valid'],
    });
  }
}

/** SQL expression selecting a row's cursor timestamp, e.g. `cursorTs('m.created_at')`. */
export function cursorTs(column: string) {
  return sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** `(created_at, id) > cursor` (or `<` for newest-first lists). */
export function afterCursor(
  createdAt: string,
  id: string,
  key: CursorKey,
  direction: 'asc' | 'desc' = 'asc',
): Expression<SqlBool> {
  const op = direction === 'asc' ? sql`>` : sql`<`;
  return sql<SqlBool>`(${sql.ref(createdAt)}, ${sql.ref(id)}) ${op} (${key.ts}::timestamptz, ${key.id}::uuid)`;
}

/** Trims the extra probe row and produces `{ items, nextCursor }`. */
export function toPage<R extends { cursor_ts: string; id: string }, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
): { items: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(map),
    nextCursor:
      rows.length > limit && last ? encodeCursor({ ts: last.cursor_ts, id: last.id }) : null,
  };
}
