import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import { API_ENV, type ApiEnv } from '../config.js';
import type { DependencyProbe } from './dependencies.js';

/** Owns the shared PostgreSQL pool and Redis client for the API process. */
@Injectable()
export class Infrastructure implements OnApplicationShutdown {
  readonly pool: pg.Pool;
  readonly redis: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
    // Swallow pool-level errors here; individual queries still reject and are handled by callers.
    this.pool.on('error', () => undefined);
    this.redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', () => undefined);
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
          if (this.redis.status === 'wait' || this.redis.status === 'end')
            await this.redis.connect();
          return (await this.redis.ping()) === 'PONG';
        },
      },
    ];
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}
