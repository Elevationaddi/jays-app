import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config.js';
import { ApiError } from '../common/error.filter.js';
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
  ) {}

  onApplicationBootstrap() {
    if (this.env.APP_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), HOUR_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 30_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
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
