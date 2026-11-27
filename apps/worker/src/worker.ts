import type { WorkerEnv } from '@jays/config';
import type { Logger } from 'pino';

/** Minimal surface of the queue connection the worker needs; lets tests run without Redis. */
export interface QueueConnection {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

/** A periodic job. Runs never overlap; a failure is logged and retried on the next tick. */
export interface Job {
  name: string;
  intervalMs: number;
  /** Returns how many items it handled (logged when non-zero). */
  run(): Promise<number>;
}

/**
 * Worker lifecycle: verifies its dependencies, runs periodic jobs (phase 3: expiring unpaid
 * orders) and shuts down cleanly, waiting for a running job to finish.
 */
export class Worker {
  private stopped = false;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly env: WorkerEnv,
    private readonly redis: QueueConnection,
    private readonly log: Logger,
    private readonly jobs: readonly Job[] = [],
  ) {}

  async start(): Promise<void> {
    const pong = await this.redis.ping();
    if (pong !== 'PONG') throw new Error('Queue connection did not answer PING');
    for (const job of this.jobs) {
      let busy = false;
      const tick = () => {
        if (busy || this.stopped) return;
        busy = true;
        const run = this.runOnce(job).finally(() => {
          busy = false;
          this.running.delete(run);
        });
        this.running.add(run);
      };
      this.timers.push(setInterval(tick, job.intervalMs));
      tick();
    }
    this.log.info(
      { appEnv: this.env.APP_ENV, handlers: this.jobs.map((j) => j.name) },
      'worker started',
    );
  }

  /** Runs one job once; errors are logged, never thrown. */
  async runOnce(job: Job): Promise<void> {
    try {
      const handled = await job.run();
      if (handled > 0) this.log.info({ job: job.name, handled }, 'job handled items');
    } catch (error) {
      this.log.error({ job: job.name, err: error }, 'job failed');
    }
  }

  async stop(signal: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.log.info({ signal }, 'worker stopping');
    for (const timer of this.timers) clearInterval(timer);
    await Promise.all(this.running);
    await this.redis.quit();
  }
}
