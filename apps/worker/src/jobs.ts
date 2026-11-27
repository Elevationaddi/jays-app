import type { Job } from './worker.js';

/** Anything that can run a parameterised SQL query (a pg Pool or Client). */
export interface SqlRunner {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/**
 * Expires unpaid orders whose payment window has ended and releases their reserved stock
 * (docs/05-workflows.md: "Timeout releases reservations"). The rule itself lives in the database
 * function `expire_unpaid_orders` (migration 0004), shared with the API, so both apply it the same
 * way under the same locks. Batches of 200; a large backlog drains over a few ticks.
 */
export function expireUnpaidOrdersJob(db: SqlRunner, intervalMs = 30_000): Job {
  return {
    name: 'expire-unpaid-orders',
    intervalMs,
    async run() {
      const { rows } = await db.query<{ n: number }>(
        'SELECT expire_unpaid_orders(now(), 200) AS n',
      );
      return Number(rows[0]?.n ?? 0);
    },
  };
}
