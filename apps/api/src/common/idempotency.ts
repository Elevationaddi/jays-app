import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { Db } from '@jays/db';
import { IDEMPOTENCY_KEY_PATTERN } from '@jays/domain';
import { ApiError } from './error.filter.js';

export interface IdempotencyScope {
  actorType: 'user' | 'admin';
  actorId: string;
  /** Stable route name, e.g. `POST /orders`. */
  route: string;
}

/** JSON with sorted keys, so the same request always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function requestHash(request: unknown): string {
  return createHash('sha256').update(canonical(request)).digest('hex');
}

export function requireIdempotencyKey(key: string | undefined): string {
  if (key === undefined || key === '') {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Send an Idempotency-Key header with this request.',
      { 'Idempotency-Key': ['is required'] },
    );
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'The Idempotency-Key header is not valid.',
      { 'Idempotency-Key': ['8 to 128 letters, digits, dashes or underscores'] },
    );
  }
  return key;
}

/**
 * Runs `run` at most once per (actor, route, key) (docs/07-api.md). An identical retry gets the
 * stored response; the same key with a different request gets 409 IDEMPOTENCY_KEY_REUSED; a
 * retry while the first request is still running gets 409 REQUEST_IN_PROGRESS. A request that
 * fails releases its key so the client can retry it.
 */
export async function idempotent<T>(
  db: Db,
  scope: IdempotencyScope,
  rawKey: string | undefined,
  request: unknown,
  run: () => Promise<T>,
  responseStatus = 201,
): Promise<T> {
  const key = requireIdempotencyKey(rawKey);
  const hash = requestHash(request);
  const claimed = await db
    .insertInto('idempotency_keys')
    .values({
      actor_type: scope.actorType,
      actor_id: scope.actorId,
      route: scope.route,
      key,
      request_hash: hash,
    })
    .onConflict((oc) => oc.columns(['actor_type', 'actor_id', 'route', 'key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!claimed) {
    const existing = await db
      .selectFrom('idempotency_keys')
      .select(['request_hash', 'status', 'response_body'])
      .where('actor_type', '=', scope.actorType)
      .where('actor_id', '=', scope.actorId)
      .where('route', '=', scope.route)
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    if (existing.request_hash !== hash) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request.',
      );
    }
    if (existing.status !== 'completed') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'REQUEST_IN_PROGRESS',
        'The same request is still being processed. Retry shortly.',
      );
    }
    return existing.response_body as T;
  }
  try {
    const result = await run();
    await db
      .updateTable('idempotency_keys')
      .set({
        status: 'completed',
        response_status: responseStatus,
        response_body: JSON.stringify(result),
      })
      .where('id', '=', claimed.id)
      .execute();
    return result;
  } catch (error) {
    await db.deleteFrom('idempotency_keys').where('id', '=', claimed.id).execute();
    throw error;
  }
}
