import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Db, JOB_SQL, type SqlJobName } from '@jays/db';
import type { Response } from 'express';
import { sql } from 'kysely';
import { NotificationsService } from '../aftercare/notifications.service.js';
import { PostgresRateLimiter } from '../common/rate-limit.js';
import { DB } from '../common/tokens.js';
import { API_ENV, type ApiEnv } from '../config.js';
import { FinanceScheduler } from '../finance/finance-scheduler.js';

/**
 * What each schedule runs (ADR-0033). Every step is idempotent and safe to overlap with another
 * run or another instance: database functions take their own locks, the outbox is claimed with
 * SKIP LOCKED, and daily reconciliation and weekly payouts claim their row first.
 */
export const CRON_SCHEDULES = {
  /** Every minute: notifications and expiring unpaid orders and booking holds. */
  minute: ['notifications', 'expire-unpaid-orders', 'expire-booking-holds'],
  /** Every 5 minutes: booking reminders and old rate-limit windows. */
  'five-minutes': ['booking-reminders', 'rate-limit-cleanup'],
  /** Hourly: payout eligibility, account deletions, daily reconciliation and weekly payouts. */
  hourly: ['mark-earnings-eligible', 'complete-account-deletions', 'finance'],
} as const satisfies Record<string, readonly string[]>;
export type CronSchedule = keyof typeof CRON_SCHEDULES;
type Step = (typeof CRON_SCHEDULES)[CronSchedule][number];

/** Up to 10 batches of 50 notifications per minute run; stops early when the outbox drains. */
const NOTIFY_BATCHES = 10;
const NOTIFY_BATCH_SIZE = 50;

/**
 * Protected cron routes for Vercel Cron (ADR-0033), which replace the in-process timers and the
 * worker when SCHEDULERS=off. Vercel sends `Authorization: Bearer $CRON_SECRET`. Disabled (404)
 * when CRON_SECRET is unset. Kept out of the public OpenAPI document.
 */
@ApiExcludeController()
@Controller('internal/cron')
export class CronController {
  private readonly log = new Logger('Cron');

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DB) private readonly db: Db,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(FinanceScheduler) private readonly finance: FinanceScheduler,
  ) {}

  @Get(':schedule')
  @Header('cache-control', 'no-store')
  async run(
    @Param('schedule') schedule: string,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ schedule: string; results: Record<string, number | 'failed'> }> {
    const secret = this.env.CRON_SECRET;
    if (!secret) throw new NotFoundException();
    if (!sameSecret(authorization ?? '', `Bearer ${secret}`)) throw new UnauthorizedException();
    if (!Object.hasOwn(CRON_SCHEDULES, schedule)) throw new NotFoundException();
    const results: Record<string, number | 'failed'> = {};
    for (const step of CRON_SCHEDULES[schedule as CronSchedule]) {
      try {
        results[step] = await this.step(step);
      } catch (error) {
        // One failing step does not stop the others; the run reports failure so it is visible.
        this.log.error({ err: error, step }, 'cron step failed');
        results[step] = 'failed';
      }
    }
    if (Object.values(results).includes('failed')) res.status(500);
    return { schedule, results };
  }

  private async step(step: Step): Promise<number> {
    switch (step) {
      case 'notifications': {
        let total = 0;
        for (let i = 0; i < NOTIFY_BATCHES; i++) {
          const sent = await this.notifications.dispatch(NOTIFY_BATCH_SIZE);
          total += sent;
          if (sent < NOTIFY_BATCH_SIZE) break;
        }
        return total;
      }
      case 'rate-limit-cleanup':
        return PostgresRateLimiter.cleanup(this.db);
      case 'finance': {
        await this.finance.tick();
        return 0;
      }
      default:
        return this.sqlJob(step);
    }
  }

  private async sqlJob(name: SqlJobName): Promise<number> {
    const { rows } = await sql<{ n: number | string | null }>`${sql.raw(JOB_SQL[name])}`.execute(
      this.db,
    );
    return Number(rows[0]?.n ?? 0);
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
