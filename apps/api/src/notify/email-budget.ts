import type { Database, Db } from '@jays/db';
import { type Kysely, sql } from 'kysely';
import type { Clock } from '../common/clock.js';

export const EMAIL_BUDGET = Symbol('EMAIL_BUDGET');

/** The share of each allowance that non-essential email may use (ADR-0024 section 7). */
export const OTHER_EMAIL_SHARE = 0.8;

/** Raised when an email would go over the plan; the caller keeps the event and retries later. */
export class EmailBudgetExceededError extends Error {
  constructor(readonly retryAt: Date) {
    super('email allowance reached');
    this.name = 'EmailBudgetExceededError';
  }
}

export interface EmailUsage {
  day: { sent: number; limit: number };
  month: { sent: number; limit: number };
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (d: Date) => `${d.toISOString().slice(0, 7)}-01`;
const nextUtcMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5));
const nextUtcMonth = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 5));

/**
 * Counts email per UTC day so JAYS stays inside Resend Free (ADR-0031): never more than the
 * daily and monthly limits, and non-essential email stops at 80% of either, keeping the rest
 * for sign-in codes and security messages. A slot is reserved before sending and released if
 * the send fails, under a transaction-scoped lock, so concurrent senders cannot overshoot.
 */
export class EmailBudget {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly dailyLimit: number,
    private readonly monthlyLimit: number,
  ) {}

  async reserve(essential: boolean): Promise<void> {
    const now = this.clock.now();
    const day = utcDay(now);
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('email_usage'))`.execute(trx);
      const usage = await this.read(trx, now);
      const share = essential ? 1 : OTHER_EMAIL_SHARE;
      if (usage.day.sent >= Math.floor(this.dailyLimit * share)) {
        throw new EmailBudgetExceededError(nextUtcMidnight(now));
      }
      if (usage.month.sent >= Math.floor(this.monthlyLimit * share)) {
        throw new EmailBudgetExceededError(nextUtcMonth(now));
      }
      const column = essential ? 'essential' : 'other';
      await trx
        .insertInto('email_usage')
        .values({ day, [column]: 1 })
        .onConflict((oc) =>
          oc.column('day').doUpdateSet((eb) => ({
            [column]: eb(`email_usage.${column}`, '+', 1),
            updated_at: now,
          })),
        )
        .execute();
    });
  }

  /** Gives a slot back after a send that the provider refused or never received. */
  async release(essential: boolean): Promise<void> {
    const column = essential ? 'essential' : 'other';
    await this.db
      .updateTable('email_usage')
      .set((eb) => ({ [column]: sql`GREATEST(${eb.ref(column)} - 1, 0)` }))
      .where('day', '=', utcDay(this.clock.now()))
      .execute();
  }

  async usage(): Promise<EmailUsage> {
    return this.read(this.db, this.clock.now());
  }

  private async read(conn: Kysely<Database>, now: Date): Promise<EmailUsage> {
    const today = utcDay(now);
    const rows = await conn
      .selectFrom('email_usage')
      .select([sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'), 'essential', 'other'])
      .where('day', '>=', monthStart(now))
      .where('day', '<=', today)
      .execute();
    const total = (r: { essential: number; other: number }) => r.essential + r.other;
    const dayRow = rows.find((r) => r.day === today);
    return {
      day: { sent: dayRow ? total(dayRow) : 0, limit: this.dailyLimit },
      month: { sent: rows.reduce((n, r) => n + total(r), 0), limit: this.monthlyLimit },
    };
  }
}
