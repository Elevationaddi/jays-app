import { parseEnv, workerEnvSchema } from '@jays/config';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { Worker, type QueueConnection } from './worker.js';

const env = parseEnv(workerEnvSchema, {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://u@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
});
const log = pino({ level: 'silent' });

function connection(pong = 'PONG'): QueueConnection & { quit: ReturnType<typeof vi.fn> } {
  return { ping: vi.fn(async () => pong), quit: vi.fn(async () => 'OK') };
}

describe('Worker', () => {
  it('starts when the queue answers', async () => {
    await expect(new Worker(env, connection(), log).start()).resolves.toBeUndefined();
  });

  it('refuses to start when the queue does not answer PING', async () => {
    await expect(new Worker(env, connection('nope'), log).start()).rejects.toThrow(/PING/);
  });

  it('closes the connection once, even if stopped twice', async () => {
    const redis = connection();
    const worker = new Worker(env, redis, log);
    await worker.stop('SIGTERM');
    await worker.stop('SIGINT');
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });
});
