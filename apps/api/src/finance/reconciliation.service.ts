import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ReconciliationItemView,
  ReconciliationListQuery,
  ReconciliationRunView,
} from '@jays/contracts';
import type { Db, ReconciliationItemKind } from '@jays/db';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { PaymentsService } from '../payments/payments.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderEvent,
  type ProviderRecord,
} from '../payments/provider.js';
import { actorOf, adminNames, iso } from './views.js';

const DAY_MS = 86_400_000;

interface Finding {
  kind: ReconciliationItemKind;
  objectType: 'payment' | 'refund' | 'payout';
  providerRef: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  payoutId?: string | null;
  localAmount?: number | null;
  providerAmount?: number | null;
  localStatus?: string | null;
  providerStatus?: string | null;
}

/**
 * Daily reconciliation against the provider's own records (docs/05-workflows.md; T15). For each
 * payment, refund and payout the provider reports for the day:
 *
 * - settled at the provider but still open here (a lost webhook): the event is replayed through
 *   the normal webhook path, exactly once, and recorded as recovered;
 * - different amount or contradicting status: flagged for finance, never changed automatically;
 * - unknown here: flagged.
 *
 * Payments we marked settled that day which the provider does not know are flagged too. One run
 * per provider and day; a failed run can be retried.
 */
@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  /** `date` is a UTC calendar day (YYYY-MM-DD); defaults to yesterday. */
  async run(adminId: string | null, date?: string, meta?: RequestMeta) {
    const now = this.clock.now();
    const start = date
      ? new Date(`${date}T00:00:00.000Z`)
      : new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS - DAY_MS);
    const end = new Date(start.getTime() + DAY_MS);
    if (end.getTime() > now.getTime()) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PERIOD_NOT_OVER',
        'A day can be reconciled once it has ended.',
      );
    }
    const runId = await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('reconciliation_runs')
        .select(['id', 'status'])
        .where('provider', '=', this.provider.name)
        .where('period_start', '=', start)
        .forUpdate()
        .executeTakeFirst();
      if (existing && existing.status !== 'failed') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ALREADY_RECONCILED',
          'This day has already been reconciled.',
        );
      }
      const id = existing
        ? (
            await trx
              .updateTable('reconciliation_runs')
              .set({ status: 'running', failure: null, finished_at: null, started_by: adminId })
              .where('id', '=', existing.id)
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id
        : (
            await trx
              .insertInto('reconciliation_runs')
              .values({
                provider: this.provider.name,
                period_start: start,
                period_end: end,
                started_by: adminId,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
      await writeAudit(trx, {
        actorType: adminId ? 'admin' : 'system',
        actorId: adminId,
        action: 'finance.reconciliation_started',
        targetType: 'reconciliation_run',
        targetId: id,
        diff: { periodStart: start, periodEnd: end },
        requestId: meta?.requestId ?? null,
      });
      return id;
    });

    try {
      const records = await this.provider.listRecords({ from: start, to: end });
      const counts = { checked: 0, recovered: 0, mismatches: 0 };
      const findings: Finding[] = [];
      for (const record of records) {
        counts.checked += 1;
        const finding = await this.check(record, runId);
        if (finding) findings.push(finding);
      }
      findings.push(...(await this.missingAtProvider(records, start, end)));
      for (const f of findings) {
        if (f.kind === 'recovered_missing_webhook') counts.recovered += 1;
        else counts.mismatches += 1;
      }
      await this.db.transaction().execute(async (trx) => {
        if (findings.length > 0) {
          await trx
            .insertInto('reconciliation_items')
            .values(
              findings.map((f) => ({
                run_id: runId,
                kind: f.kind,
                object_type: f.objectType,
                provider_ref: f.providerRef,
                payment_id: f.paymentId ?? null,
                refund_id: f.refundId ?? null,
                payout_id: f.payoutId ?? null,
                local_amount_fils: f.localAmount ?? null,
                provider_amount_fils: f.providerAmount ?? null,
                local_status: f.localStatus ?? null,
                provider_status: f.providerStatus ?? null,
                // A recovered webhook needs no action; it is recorded for the audit trail.
                resolved_at: f.kind === 'recovered_missing_webhook' ? this.clock.now() : null,
                resolved_by: null,
                resolution_note:
                  f.kind === 'recovered_missing_webhook' ? 'Applied automatically.' : null,
              })),
            )
            .execute();
        }
        await trx
          .updateTable('reconciliation_runs')
          .set({
            status: 'completed',
            checked_count: counts.checked,
            recovered_count: counts.recovered,
            mismatch_count: counts.mismatches,
            finished_at: this.clock.now(),
          })
          .where('id', '=', runId)
          .execute();
        if (counts.mismatches > 0) {
          await trx
            .insertInto('outbox')
            .values({
              event_type: 'reconciliation.mismatch',
              payload: JSON.stringify({ runId, mismatches: counts.mismatches }),
              available_at: this.clock.now(),
            })
            .execute();
        }
      });
    } catch (error) {
      this.log.error({ err: error, runId }, 'reconciliation failed');
      await this.db
        .updateTable('reconciliation_runs')
        .set({
          status: 'failed',
          finished_at: this.clock.now(),
          failure: error instanceof Error ? error.message.slice(0, 500) : 'failed',
        })
        .where('id', '=', runId)
        .execute();
    }
    return this.get(runId);
  }

  private async replay(event: ProviderEvent) {
    const hash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    await this.payments.ingest(event, hash);
  }

  private async check(r: ProviderRecord, runId: string): Promise<Finding | null> {
    const base = {
      providerRef: r.ref,
      providerAmount: r.amountFils,
      providerStatus: r.status,
    };
    const event = (type: string, extra: Partial<ProviderEvent> = {}): ProviderEvent => ({
      // Deterministic: replaying twice (or a late real webhook) is a no-op.
      id: `recon_${type}_${r.ref}`,
      type,
      intentId: r.intentId ?? '',
      amountFils: r.amountFils,
      currency: r.currency,
      refundId: null,
      payoutId: null,
      reference: null,
      failureCode: r.status === 'failed' ? 'reconciled_failure' : null,
      ...extra,
    });
    if (r.kind === 'payment') {
      const p = await this.db
        .selectFrom('payments')
        .select(['id', 'amount_fils', 'status'])
        .where('provider', '=', this.provider.name)
        .where('provider_intent_id', '=', r.ref)
        .executeTakeFirst();
      if (!p) return { ...base, kind: 'unknown_locally', objectType: 'payment' };
      const local = { paymentId: p.id, localAmount: p.amount_fils, localStatus: p.status };
      if (p.amount_fils !== r.amountFils) {
        return { ...base, ...local, kind: 'amount_mismatch', objectType: 'payment' };
      }
      if (p.status === 'requires_payment') {
        await this.replay(
          event(
            r.status === 'succeeded' ? 'payment_intent.succeeded' : 'payment_intent.payment_failed',
          ),
        );
        return { ...base, ...local, kind: 'recovered_missing_webhook', objectType: 'payment' };
      }
      const settled = p.status !== 'failed';
      if (settled !== (r.status === 'succeeded')) {
        return { ...base, ...local, kind: 'status_mismatch', objectType: 'payment' };
      }
      await this.db
        .updateTable('payments')
        .set({ reconciled_at: this.clock.now() })
        .where('id', '=', p.id)
        .execute();
      return null;
    }
    if (r.kind === 'refund') {
      const f = await this.db
        .selectFrom('refunds')
        .select(['id', 'payment_id', 'amount_fils', 'status'])
        .where('provider_ref', '=', r.ref)
        .executeTakeFirst();
      if (!f) return { ...base, kind: 'unknown_locally', objectType: 'refund' };
      const local = {
        refundId: f.id,
        paymentId: f.payment_id,
        localAmount: f.amount_fils,
        localStatus: f.status,
      };
      if (f.amount_fils !== r.amountFils) {
        return { ...base, ...local, kind: 'amount_mismatch', objectType: 'refund' };
      }
      if (f.status === 'pending') {
        await this.replay(
          event(r.status === 'succeeded' ? 'refund.succeeded' : 'refund.failed', {
            refundId: r.ref,
          }),
        );
        return { ...base, ...local, kind: 'recovered_missing_webhook', objectType: 'refund' };
      }
      if ((f.status === 'succeeded') !== (r.status === 'succeeded')) {
        return { ...base, ...local, kind: 'status_mismatch', objectType: 'refund' };
      }
      return null;
    }
    const po = await this.db
      .selectFrom('payouts')
      .select(['id', 'amount_fils', 'status'])
      .where('provider_ref', '=', r.ref)
      .executeTakeFirst();
    if (!po) return { ...base, kind: 'unknown_locally', objectType: 'payout' };
    const local = { payoutId: po.id, localAmount: po.amount_fils, localStatus: po.status };
    if (po.amount_fils !== r.amountFils) {
      return { ...base, ...local, kind: 'amount_mismatch', objectType: 'payout' };
    }
    if (po.status === 'pending') {
      await this.replay(
        event(r.status === 'paid' ? 'payout.paid' : 'payout.failed', { payoutId: r.ref }),
      );
      return { ...base, ...local, kind: 'recovered_missing_webhook', objectType: 'payout' };
    }
    if ((po.status === 'paid') !== (r.status === 'paid')) {
      return { ...base, ...local, kind: 'status_mismatch', objectType: 'payout' };
    }
    void runId;
    return null;
  }

  /** Payments and payouts we settled in the period that the provider has no record of. */
  private async missingAtProvider(records: ProviderRecord[], start: Date, end: Date) {
    const known = new Set(records.map((r) => r.ref));
    const findings: Finding[] = [];
    const payments = await this.db
      .selectFrom('payments')
      .select(['id', 'provider_intent_id', 'amount_fils', 'status'])
      .where('provider', '=', this.provider.name)
      .where('succeeded_at', '>=', start)
      .where('succeeded_at', '<', end)
      .execute();
    for (const p of payments) {
      if (p.provider_intent_id && known.has(p.provider_intent_id)) continue;
      findings.push({
        kind: 'unknown_at_provider',
        objectType: 'payment',
        providerRef: p.provider_intent_id,
        paymentId: p.id,
        localAmount: p.amount_fils,
        localStatus: p.status,
      });
    }
    const payouts = await this.db
      .selectFrom('payouts')
      .select(['id', 'provider_ref', 'amount_fils', 'status'])
      .where('provider', '=', this.provider.name)
      .where('paid_at', '>=', start)
      .where('paid_at', '<', end)
      .execute();
    for (const p of payouts) {
      if (p.provider_ref && known.has(p.provider_ref)) continue;
      findings.push({
        kind: 'unknown_at_provider',
        objectType: 'payout',
        providerRef: p.provider_ref,
        payoutId: p.id,
        localAmount: p.amount_fils,
        localStatus: p.status,
      });
    }
    return findings;
  }

  async list(query: ReconciliationListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('reconciliation_runs as r')
      .select(['r.id', cursorTs('r.started_at').as('cursor_ts')]);
    if (key) q = q.where(afterCursor('r.started_at', 'r.id', key, 'desc'));
    const rows = await q
      .orderBy('r.started_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = toPage(rows, query.limit, (r) => r.id);
    return {
      items: await Promise.all(page.items.map((id) => this.get(id))),
      nextCursor: page.nextCursor,
    };
  }

  async get(id: string): Promise<ReconciliationRunView> {
    const run = await this.db
      .selectFrom('reconciliation_runs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!run) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The run was not found.');
    const items = await this.db
      .selectFrom('reconciliation_items')
      .selectAll()
      .where('run_id', '=', id)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const names = await adminNames(this.db, [run.started_by, ...items.map((i) => i.resolved_by)]);
    return {
      id: run.id,
      periodStart: run.period_start.toISOString(),
      periodEnd: run.period_end.toISOString(),
      status: run.status,
      checkedCount: run.checked_count,
      recoveredCount: run.recovered_count,
      mismatchCount: run.mismatch_count,
      startedBy: actorOf(names, run.started_by),
      startedAt: run.started_at.toISOString(),
      finishedAt: iso(run.finished_at),
      failure: run.failure,
      items: items.map((i): ReconciliationItemView => ({
        id: i.id,
        runId: i.run_id,
        kind: i.kind,
        objectType: i.object_type,
        providerRef: i.provider_ref,
        paymentId: i.payment_id,
        refundId: i.refund_id,
        payoutId: i.payout_id,
        localAmountFils: i.local_amount_fils,
        providerAmountFils: i.provider_amount_fils,
        localStatus: i.local_status,
        providerStatus: i.provider_status,
        resolvedAt: iso(i.resolved_at),
        resolvedBy: actorOf(names, i.resolved_by),
        resolutionNote: i.resolution_note,
        createdAt: i.created_at.toISOString(),
      })),
    };
  }

  async resolveItem(adminId: string, itemId: string, note: string, meta: RequestMeta) {
    const runId = await this.db.transaction().execute(async (trx) => {
      const item = await trx
        .updateTable('reconciliation_items')
        .set({ resolved_at: this.clock.now(), resolved_by: adminId, resolution_note: note })
        .where('id', '=', itemId)
        .where('resolved_at', 'is', null)
        .returning(['id', 'run_id'])
        .executeTakeFirst();
      if (!item) {
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No open item with that id.');
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.reconciliation_item_resolved',
        targetType: 'reconciliation_item',
        targetId: itemId,
        reason: note,
        requestId: meta.requestId,
      });
      return item.run_id;
    });
    return this.get(runId);
  }
}
