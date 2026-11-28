import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { CLOCK, type Clock } from '../common/clock.js';
import { DB } from '../common/tokens.js';
import { API_ENV, type ApiEnv } from '../config.js';
import { gauge, HttpMetrics } from './http-metrics.js';

/** Grace period before an expired hold counts as stuck: the sweepers run every few seconds. */
export const STUCK_AFTER_SECONDS = 120;

/**
 * Prometheus scrape endpoint (ADR-0017). Disabled (404) unless METRICS_TOKEN is set; production
 * refuses to start without it. Kept out of the public OpenAPI document.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(HttpMetrics) private readonly http: HttpMetrics,
  ) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('cache-control', 'no-store')
  async scrape(@Headers('authorization') authorization: string | undefined): Promise<string> {
    const token = this.env.METRICS_TOKEN;
    if (!token) throw new NotFoundException();
    if (!sameSecret(authorization ?? '', `Bearer ${token}`)) throw new UnauthorizedException();
    return this.http.render() + (await this.business());
  }

  /** Operational gauges read from the database at scrape time. */
  private async business(): Promise<string> {
    const now = this.clock.now();
    const stuck = new Date(now.getTime() - STUCK_AFTER_SECONDS * 1000);
    const { rows } = await sql<Record<string, string | null>>`
      SELECT
        (SELECT count(*) FROM outbox WHERE status IN ('pending', 'processing')) AS outbox_pending,
        (SELECT count(*) FROM outbox WHERE status = 'failed') AS outbox_failed,
        (SELECT extract(epoch FROM ${now}::timestamptz - min(created_at)) FROM outbox
           WHERE status IN ('pending', 'processing')) AS outbox_oldest,
        (SELECT count(*) FROM bookings WHERE status = 'held' AND hold_expires_at < ${stuck}) AS holds_stuck,
        (SELECT count(*) FROM reservations WHERE status = 'active' AND expires_at < ${stuck}) AS reservations_stuck,
        (SELECT count(*) FROM payments WHERE needs_attention) AS payments_attention,
        (SELECT count(*) FROM payouts WHERE status = 'failed' OR needs_attention) AS payout_exceptions,
        (SELECT count(*) FROM reconciliation_items
           WHERE resolved_at IS NULL AND kind <> 'recovered_missing_webhook') AS recon_open,
        (SELECT extract(epoch FROM max(finished_at)) FROM reconciliation_runs
           WHERE status = 'completed') AS recon_last,
        (SELECT count(*) FROM support_tickets WHERE status IN ('open', 'assigned', 'reopened')
           AND sla_due_at < ${now}) AS tickets_overdue,
        (SELECT count(*) FROM disputes WHERE status = 'open') AS disputes_open
    `.execute(this.db);
    const r = rows[0] ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    const out: string[] = [];
    gauge(
      out,
      'jays_outbox_pending',
      'Notification events waiting to be sent.',
      n('outbox_pending'),
    );
    gauge(
      out,
      'jays_outbox_failed',
      'Notification events that gave up after all retries.',
      n('outbox_failed'),
    );
    gauge(
      out,
      'jays_outbox_oldest_pending_seconds',
      'Age of the oldest unsent notification event.',
      Math.max(0, n('outbox_oldest')),
    );
    gauge(
      out,
      'jays_booking_holds_stuck',
      `Booking holds expired more than ${STUCK_AFTER_SECONDS}s ago and still held.`,
      n('holds_stuck'),
    );
    gauge(
      out,
      'jays_stock_reservations_stuck',
      `Stock reservations expired more than ${STUCK_AFTER_SECONDS}s ago and still active.`,
      n('reservations_stuck'),
    );
    gauge(
      out,
      'jays_payments_needing_attention',
      'Payments flagged for operations.',
      n('payments_attention'),
    );
    gauge(
      out,
      'jays_payout_exceptions',
      'Payouts that failed or need attention.',
      n('payout_exceptions'),
    );
    gauge(
      out,
      'jays_reconciliation_open_mismatches',
      'Unresolved reconciliation findings.',
      n('recon_open'),
    );
    gauge(
      out,
      'jays_reconciliation_last_success_timestamp_seconds',
      'When the last reconciliation run completed (0 if never).',
      n('recon_last'),
    );
    gauge(
      out,
      'jays_support_tickets_overdue',
      'Tickets waiting for support past the first-reply SLA.',
      n('tickets_overdue'),
    );
    gauge(out, 'jays_disputes_open', 'Open payment disputes.', n('disputes_open'));
    return out.join('\n') + '\n';
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
