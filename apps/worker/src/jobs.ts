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

/**
 * Expires booking holds whose 10 minutes are up, freeing the staff member's time
 * (docs/05-workflows.md, appointment step 3). The rule is the database function
 * `expire_booking_holds` (migration 0005), which the API also runs before allocating a hold.
 */
export function expireBookingHoldsJob(db: SqlRunner, intervalMs = 30_000): Job {
  return {
    name: 'expire-booking-holds',
    intervalMs,
    async run() {
      const { rows } = await db.query<{ n: number }>(
        'SELECT expire_booking_holds(now(), 200) AS n',
      );
      return Number(rows[0]?.n ?? 0);
    },
  };
}

/**
 * Makes merchant earnings eligible for payout once the visit is done or the suborder delivered
 * and the dispute window has passed (docs/05-workflows.md, payouts; ADR-0015). The window is the
 * finance setting in force (default 7 days). The rule is `mark_earnings_eligible` (migration
 * 0006), which payout runs also call first.
 */
export const MARK_EARNINGS_ELIGIBLE_SQL = `SELECT mark_earnings_eligible(now(), coalesce(
  (SELECT value FROM finance_settings
    WHERE key = 'payout_dispute_window_days' AND effective_at <= now()
    ORDER BY effective_at DESC LIMIT 1), 7)) AS n`;

export function markEarningsEligibleJob(db: SqlRunner, intervalMs = 600_000): Job {
  return {
    name: 'mark-earnings-eligible',
    intervalMs,
    async run() {
      const { rows } = await db.query<{ n: number }>(MARK_EARNINGS_ELIGIBLE_SQL);
      return Number(rows[0]?.n ?? 0);
    },
  };
}

/**
 * Anonymises accounts whose deletion grace period has ended (ADR-0019). The rule is the database
 * function `complete_account_deletions` (migration 0008), which postpones a request by a day if an
 * order, appointment, return or membership became active during the grace period.
 */
export function completeAccountDeletionsJob(db: SqlRunner, intervalMs = 3_600_000): Job {
  return {
    name: 'complete-account-deletions',
    intervalMs,
    async run() {
      const { rows } = await db.query<{ n: number }>(
        'SELECT complete_account_deletions(now(), 50) AS n',
      );
      return Number(rows[0]?.n ?? 0);
    },
  };
}

/**
 * Queues appointment reminders about 24 hours ahead and expires waitlist entries for days that
 * have passed (phase 8.7, ADR-0026). The rules are the database functions
 * `queue_booking_reminders` and `expire_waitlist_entries` (migration 0013); each reminder is
 * marked sent in the same statement, so a booking is reminded once however often this runs.
 */
export const BOOKING_REMINDERS_SQL =
  'SELECT queue_booking_reminders(now(), 24, 200) + expire_waitlist_entries(now()) AS n';

export function bookingRemindersJob(db: SqlRunner, intervalMs = 300_000): Job {
  return {
    name: 'booking-reminders',
    intervalMs,
    async run() {
      const { rows } = await db.query<{ n: number }>(BOOKING_REMINDERS_SQL);
      return Number(rows[0]?.n ?? 0);
    },
  };
}
