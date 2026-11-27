import { parseEnv, workerEnvSchema } from '@jays/config';
import { Redis } from 'ioredis';
import pg from 'pg';
import { pino } from 'pino';
import { expireUnpaidOrdersJob } from './jobs.js';
import { Worker } from './worker.js';

const env = parseEnv(workerEnvSchema, process.env);
const log = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 });
const worker = new Worker(env, redis, log, [expireUnpaidOrdersJob(pool)]);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    worker
      .stop(signal)
      .then(() => pool.end())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          log.error({ err: error }, 'worker failed to stop cleanly');
          process.exit(1);
        },
      );
  });
}

try {
  await worker.start();
} catch (error) {
  log.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
}
