import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createDb, type Db } from '@jays/db';
import pg from 'pg';
import { API_ENV, type ApiEnv } from '../config.js';
import type { DependencyProbe } from './dependencies.js';

/**
 * Owns the shared PostgreSQL pool and, when rate limits use Redis, the Redis client. On Vercel
 * (ADR-0033) there is no Redis and the pool is small, behind Supabase's transaction pooler.
 */
@Injectable()
export class Infrastructure implements OnApplicationShutdown {
  readonly pool: pg.Pool;
  readonly redis: Redis | null;
  readonly db: Db;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      // Serverless instances freeze between requests; do not hold idle connections for long.
      idleTimeoutMillis: 10_000,
    });
    // Swallow pool-level errors here; individual queries still reject and are handled by callers.
    this.pool.on('error', () => undefined);
    this.db = createDb(this.pool);
    this.redis =
      env.RATE_LIMIT_STORE === 'redis' && env.REDIS_URL
        ? new Redis(env.REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
          })
        : null;
    this.redis?.on('error', () => undefined);
  }

  private connecting: Promise<void> | undefined;

  /** Redis connects lazily; concurrent first callers share one connection attempt. */
  async redisReady(): Promise<void> {
    if (!this.redis) throw new Error('redis is not configured');
    if (this.redis.status === 'ready') return;
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      const redis = this.redis;
      this.connecting ??= redis.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    if (this.connecting) await this.connecting;
  }

  probes(): DependencyProbe[] {
    const probes: DependencyProbe[] = [
      {
        name: 'database',
        check: async () => (await this.pool.query('SELECT 1 AS ok')).rows[0]?.ok === 1,
      },
    ];
    const redis = this.redis;
    if (redis) {
      probes.push({
        name: 'redis',
        check: async () => {
          await this.redisReady();
          return (await redis.ping()) === 'PONG';
        },
      });
    }
    return probes;
  }

  async onApplicationShutdown(): Promise<void> {
    // quit() waits for a connection that a never-used lazy client will not open; disconnect instead.
    const redis = this.redis;
    const closeRedis = !redis
      ? Promise.resolve()
      : redis.status === 'ready'
        ? redis.quit()
        : Promise.resolve(redis.disconnect());
    await Promise.allSettled([this.pool.end(), closeRedis]);
  }
}
