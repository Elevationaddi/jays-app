/**
 * The scheduled maintenance jobs, as single SQL statements over database functions. Shared by the
 * worker (timers, for self-hosting) and the API's cron routes (Vercel Cron, ADR-0033), so both
 * apply exactly the same rules under the same locks. Each statement returns `n`, the number of
 * items handled, and is safe to run more often than scheduled or from several places at once.
 */
export const JOB_SQL = {
  /** Unpaid orders past their payment window release their reserved stock (migration 0004). */
  'expire-unpaid-orders': 'SELECT expire_unpaid_orders(now(), 200) AS n',
  /** Booking holds whose 10 minutes are up free the staff member's time (migration 0005). */
  'expire-booking-holds': 'SELECT expire_booking_holds(now(), 200) AS n',
  /**
   * Merchant earnings become eligible for payout after the dispute window (migration 0006,
   * ADR-0015), using the finance setting in force (default 7 days).
   */
  'mark-earnings-eligible': `SELECT mark_earnings_eligible(now(), coalesce(
  (SELECT value FROM finance_settings
    WHERE key = 'payout_dispute_window_days' AND effective_at <= now()
    ORDER BY effective_at DESC LIMIT 1), 7)) AS n`,
  /** Accounts whose deletion grace period has ended are anonymised (migration 0008, ADR-0019). */
  'complete-account-deletions': 'SELECT complete_account_deletions(now(), 50) AS n',
  /** Booking reminders a day ahead, and expired waitlist offers (migration 0013, ADR-0026). */
  'booking-reminders':
    'SELECT queue_booking_reminders(now(), 24, 200) + expire_waitlist_entries(now()) AS n',
} as const;

export type SqlJobName = keyof typeof JOB_SQL;
