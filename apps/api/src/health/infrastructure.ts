import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createDb, type Db } from '@jays/db';
import pg from 'pg';
import { API_ENV, type ApiEnv } from '../config.js';
import type { DependencyProbe } from './dependencies.js';

/** Owns the shared PostgreSQL pool and Redis client for the API process. */
@Injectable()
export class Infrastructure implements OnApplicationShutdown {
  readonly pool: pg.Pool;
  readonly redis: Redis;
  readonly db: Db;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
    // Swallow pool-level errors here; individual queries still reject and are handled by callers.
    this.pool.on('error', () => undefined);
    this.db = createDb(this.pool);
    this.redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', () => undefined);
  }

  private connecting: Promise<void> | undefined;

  /** Redis connects lazily; concurrent first callers share one connection attempt. */
  async redisReady(): Promise<void> {
    if (this.redis.status === 'ready') return;
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      this.connecting ??= this.redis.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    if (this.connecting) await this.connecting;
  }

  probes(): DependencyProbe[] {
    return [
      {
        name: 'database',
        check: async () => (await this.pool.query('SELECT 1 AS ok')).rows[0]?.ok === 1,
      },
      {
        name: 'redis',
        check: async () => {
          await this.redisReady();
          return (await this.redis.ping()) === 'PONG';
        },
      },
    ];
  }

  async onApplicationShutdown(): Promise<void> {
    // quit() waits for a connection that a never-used lazy client will not open; disconnect instead.
    const closeRedis =
      this.redis.status === 'ready' ? this.redis.quit() : Promise.resolve(this.redis.disconnect());
    await Promise.allSettled([this.pool.end(), closeRedis]);
  }
}
