import type { WorkerEnv } from '@jays/config';
import type { Logger } from 'pino';

/** Minimal surface of the queue connection the worker needs; lets tests run without Redis. */
export interface QueueConnection {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

/**
 * Worker lifecycle. Phase 0 only verifies its dependencies and shuts down cleanly. Job handlers
 * (hold expiry, outbox delivery, reconciliation) are registered here from phase 1 onward.
 */
export class Worker {
  private stopped = false;

  constructor(
    private readonly env: WorkerEnv,
    private readonly redis: QueueConnection,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    const pong = await this.redis.ping();
    if (pong !== 'PONG') throw new Error('Queue connection did not answer PING');
    this.log.info({ appEnv: this.env.APP_ENV, handlers: [] }, 'worker started');
  }

  async stop(signal: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.log.info({ signal }, 'worker stopping');
    await this.redis.quit();
  }
}
