import { HttpStatus } from '@nestjs/common';
import type { Db } from '@jays/db';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { ApiError } from './error.filter.js';

export interface RateLimitRule {
  /** Short stable name, part of the Redis key. */
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window counters. Redis is used for rate limits only, never for authoritative locks. */
export interface RateLimiter {
  consume(rule: RateLimitRule, subject: string): Promise<RateLimitResult>;
}

export const RATE_LIMITER = Symbol('RATE_LIMITER');

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
    private readonly ensureConnected: () => Promise<void>,
  ) {}

  async consume(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = `rl:${this.namespace}:${rule.name}:${subject}`;
    try {
      await this.ensureConnected();
      const result = await this.redis
        .multi()
        .incr(key)
        .expire(key, rule.windowSeconds, 'NX')
        .ttl(key)
        .exec();
      const count = Number(result?.[0]?.[1] ?? 0);
      const ttl = Math.max(1, Number(result?.[2]?.[1] ?? rule.windowSeconds));
      return {
        allowed: count <= rule.limit,
        remaining: Math.max(0, rule.limit - count),
        retryAfterSeconds: count <= rule.limit ? 0 : ttl,
      };
    } catch {
      // Fail closed: without the limiter, credential endpoints would be open to brute force.
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DEPENDENCY_UNAVAILABLE',
        'Please try again shortly.',
      );
    }
  }
}

/**
 * Fixed-window counters in PostgreSQL (ADR-0033), for Vercel where there is no Redis. One atomic
 * upsert per check: a window that has ended restarts at 1, otherwise the count goes up. Expired
 * rows are removed by the cleanup cron. Fails closed like the Redis limiter.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly namespace: string,
  ) {}

  async consume(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = `${this.namespace}:${rule.name}:${subject}`.slice(0, 512);
    try {
      const row = await this.db
        .insertInto('rate_limit_counters')
        .values({
          key,
          count: 1,
          reset_at: sql<Date>`now() + make_interval(secs => ${rule.windowSeconds})`,
        })
        .onConflict((oc) =>
          oc.column('key').doUpdateSet({
            count: sql<number>`CASE WHEN rate_limit_counters.reset_at <= now() THEN 1
              ELSE rate_limit_counters.count + 1 END`,
            reset_at: sql<Date>`CASE WHEN rate_limit_counters.reset_at <= now()
              THEN excluded.reset_at ELSE rate_limit_counters.reset_at END`,
          }),
        )
        .returning([
          'count',
          sql<number>`greatest(1, ceil(extract(epoch FROM reset_at - now())))::int`.as('ttl'),
        ])
        .executeTakeFirstOrThrow();
      const allowed = row.count <= rule.limit;
      return {
        allowed,
        remaining: Math.max(0, rule.limit - row.count),
        retryAfterSeconds: allowed ? 0 : row.ttl,
      };
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DEPENDENCY_UNAVAILABLE',
        'Please try again shortly.',
      );
    }
  }

  /** Deletes windows that ended more than a minute ago. */
  static async cleanup(db: Db): Promise<number> {
    const res = await db
      .deleteFrom('rate_limit_counters')
      .where('reset_at', '<', sql<Date>`now() - interval '1 minute'`)
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }
}

/** In-process limiter for unit tests. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = `${rule.name}:${subject}`;
    const now = this.now();
    let entry = this.counts.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + rule.windowSeconds * 1000 };
      this.counts.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= rule.limit;
    return {
      allowed,
      remaining: Math.max(0, rule.limit - entry.count),
      retryAfterSeconds: allowed ? 0 : Math.ceil((entry.resetAt - now) / 1000),
    };
  }
}

export class RateLimitedError extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Too many attempts. Please wait and try again.',
    );
  }
}

/** Consumes every rule; throws 429 with the longest wait if any is exceeded. */
export async function enforce(
  limiter: RateLimiter,
  checks: [RateLimitRule, string][],
): Promise<void> {
  const results = await Promise.all(
    checks.map(([rule, subject]) => limiter.consume(rule, subject)),
  );
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length > 0) {
    throw new RateLimitedError(Math.max(...blocked.map((r) => r.retryAfterSeconds)));
  }
}
