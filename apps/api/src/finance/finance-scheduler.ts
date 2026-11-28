import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';
import type { Db } from '@jays/db';
import { setting } from './ledger.js';
import { PayoutsService } from './payouts.service.js';
import { ReconciliationService } from './reconciliation.service.js';

const HOUR_MS = 3_600_000;

/**
 * Runs yesterday's reconciliation once a day (docs/05-workflows.md: reconcile daily). It checks
 * hourly; the unique (provider, day) row makes extra attempts, or several API instances, no-ops.
 * It lives in the API because the provider adapter does (the mock keeps state in memory); with a
 * real provider it can move to the worker. Off in tests, which run reconciliation directly.
 */
@Injectable()
export class FinanceScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(FinanceScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(ReconciliationService) private readonly recon: ReconciliationService,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    // On Vercel the cron routes run this instead (ADR-0033).
    if (this.env.APP_ENV === 'test' || this.env.SCHEDULERS === 'off') return;
    this.timer = setInterval(() => void this.tick(), HOUR_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 30_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    await this.reconcile();
    await this.weeklyPayouts();
  }

  /**
   * D6: one payout run a week, on the configured UAE weekday, after 06:00 UAE time. The row for
   * the day is claimed first, so several API instances, or several hourly ticks, run it once.
   * Eligibility (7 days after delivery or completion), holds, open disputes, pending refunds and
   * negative balances are all applied by the run itself. Admins can still run payouts by hand.
   */
  async weeklyPayouts(now = this.clock.now()) {
    const uae = new Date(now.getTime() + 4 * HOUR_MS);
    const weekday = uae.getUTCDay() === 0 ? 7 : uae.getUTCDay();
    if (uae.getUTCHours() < 6) return null;
    if (weekday !== (await setting(this.db, 'payout_weekday', now))) return null;
    const day = uae.toISOString().slice(0, 10);
    const claim = await this.db
      .insertInto('payout_runs')
      .values({ scheduled_for: day })
      .onConflict((oc) => oc.column('scheduled_for').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!claim) return null;
    try {
      const result = await this.payouts.run(null);
      await this.db
        .updateTable('payout_runs')
        .set({
          made_eligible: result.madeEligible,
          payouts: result.payouts.length,
          skipped: result.skipped.length,
          finished_at: this.clock.now(),
        })
        .where('id', '=', claim.id)
        .execute();
      this.log.log(
        { day, payouts: result.payouts.length, skipped: result.skipped.length },
        'weekly payout run finished',
      );
      return result;
    } catch (error) {
      // The claim stays unfinished (no finished_at), so the failed week is visible; admins can
      // still run payouts by hand.
      this.log.error({ err: error, day }, 'weekly payout run failed');
      return null;
    }
  }

  private async reconcile() {
    try {
      const run = await this.recon.run(null);
      this.log.log(
        { runId: run.id, mismatches: run.mismatchCount, recovered: run.recoveredCount },
        'daily reconciliation finished',
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ALREADY_RECONCILED') return;
      this.log.error({ err: error }, 'daily reconciliation could not start');
    }
  }
}
