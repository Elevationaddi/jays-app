import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminEarningListQuery,
  AdminPayment,
  AdminPaymentListQuery,
  DisputeInput,
  DisputeListQuery,
  DisputeResolution,
  DisputeView,
  FeeRuleInput,
  FeeRuleView,
  FinanceOverview,
  FinanceSettingInput,
  FinanceSettingView,
  PayoutHoldInput,
  PayoutHoldView,
  RefundDecision,
  RefundRequestInput,
  RefundRequestListQuery,
  RefundRequestView,
} from '@jays/contracts';
import {
  canApproveRefund,
  FINANCE_SETTING_DEFAULTS,
  FINANCE_SETTING_KEYS,
  FINANCE_SETTING_LIMITS,
  inForce,
  needsSecondApproval,
} from '@jays/domain';
import type { Db } from '@jays/db';
import { sql } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { PaymentsService, type RefundJob } from '../payments/payments.service.js';
import { earningForRefund, reverseEarning, setting, type Trx } from './ledger.js';
import {
  actorOf,
  adminNames,
  businessName,
  EARNING_COLUMNS,
  earningView,
  type EarningRow,
  iso,
  type Localized,
  openDisputeExists,
} from './views.js';

const notFound = (what: string) =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} was not found.`);
const exceeds = () =>
  new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'REFUND_EXCEEDS_CAPTURE',
    'Refunds cannot add up to more than was paid.',
  );
const REFUNDABLE = ['succeeded', 'refund_pending', 'partially_refunded', 'refund_failed'];

/**
 * Finance operations for platform admins (docs/04-admin.md, /admin/finance; ADR-0015). Fee rules
 * and settings are versioned and effective-dated (new rows, never edits). Refunds above the
 * threshold need a second admin (T16). Every change is audited.
 */
@Injectable()
export class AdminFinanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  // Overview ----------------------------------------------------------------------------------

  async overview(): Promise<FinanceOverview> {
    const now = this.clock.now();
    const balances = await this.db
      .selectFrom('ledger_entries')
      .select(['account', sql<string>`sum(debit_fils - credit_fils)`.as('net')])
      .groupBy('account')
      .execute();
    const net = (account: string) => Number(balances.find((b) => b.account === account)?.net ?? 0);
    const { rows: counts } = await sql<{
      payments: string;
      payouts: string;
      requests: string;
      disputes: string;
      holds: string;
      items: string;
    }>`SELECT
        (SELECT count(*) FROM payments WHERE needs_attention) AS payments,
        (SELECT count(*) FROM payouts WHERE needs_attention) AS payouts,
        (SELECT count(*) FROM refund_requests WHERE status = 'pending_approval') AS requests,
        (SELECT count(*) FROM disputes WHERE status = 'open') AS disputes,
        (SELECT count(*) FROM payout_holds WHERE released_at IS NULL) AS holds,
        (SELECT count(*) FROM reconciliation_items WHERE resolved_at IS NULL) AS items`.execute(
      this.db,
    );
    const c = counts[0];
    const last = await this.db
      .selectFrom('reconciliation_runs')
      .selectAll()
      .orderBy('period_start', 'desc')
      .limit(1)
      .executeTakeFirst();
    return {
      currency: 'AED',
      balances: {
        pspClearingFils: net('psp_clearing'),
        merchantPayableFils: -net('merchant_payable'),
        payoutsInTransitFils: -net('payouts_in_transit'),
        platformCommissionFils: -net('platform_commission'),
        unallocatedReceiptsFils: -net('unallocated_receipts'),
      },
      paymentsNeedingAttention: Number(c?.payments ?? 0),
      payoutsNeedingAttention: Number(c?.payouts ?? 0),
      refundRequestsPending: Number(c?.requests ?? 0),
      openDisputes: Number(c?.disputes ?? 0),
      activeHolds: Number(c?.holds ?? 0),
      openReconciliationItems: Number(c?.items ?? 0),
      lastReconciliation: last
        ? {
            id: last.id,
            periodStart: last.period_start.toISOString(),
            status: last.status,
            mismatchCount: last.mismatch_count,
            recoveredCount: last.recovered_count,
            finishedAt: iso(last.finished_at),
          }
        : null,
      settings: await this.settings(now),
      feeRules: await this.feeRules(now),
    };
  }

  async settings(now = this.clock.now()): Promise<FinanceSettingView[]> {
    const rows = await this.db
      .selectFrom('finance_settings')
      .selectAll()
      .where('effective_at', '<=', now)
      .execute();
    const names = await adminNames(
      this.db,
      rows.map((r) => r.created_by),
    );
    return FINANCE_SETTING_KEYS.map((key) => {
      const row = inForce(
        rows.filter((r) => r.key === key).map((r) => ({ ...r, effectiveAt: r.effective_at })),
        now,
      );
      return row
        ? {
            id: row.id,
            key,
            value: row.value,
            effectiveAt: row.effective_at.toISOString(),
            reason: row.reason,
            createdBy: actorOf(names, row.created_by),
            isDefault: false,
          }
        : {
            id: null,
            key,
            value: FINANCE_SETTING_DEFAULTS[key],
            effectiveAt: null,
            reason: null,
            createdBy: null,
            isDefault: true,
          };
    });
  }

  async feeRules(now = this.clock.now()): Promise<FeeRuleView[]> {
    const rows = await this.db
      .selectFrom('fee_rules as f')
      .leftJoin('businesses as b', 'b.id', 'f.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'f.id',
        'f.mode',
        'f.business_id',
        'f.commission_bps',
        'f.effective_at',
        'f.reason',
        'f.created_by',
        'f.created_at',
        'b.display_name',
        'sf.live_name',
      ])
      .orderBy('f.effective_at', 'desc')
      .limit(200)
      .execute();
    const names = await adminNames(
      this.db,
      rows.map((r) => r.created_by),
    );
    const current = new Set<string>();
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.mode}:${r.business_id ?? ''}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const group of groups.values()) {
      const r = inForce(
        group.map((g) => ({ ...g, effectiveAt: g.effective_at })),
        now,
      );
      if (r) current.add(r.id);
    }
    return rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      business:
        r.business_id && r.display_name
          ? {
              id: r.business_id,
              name: businessName(r.live_name as Localized | null, r.display_name as Localized),
            }
          : null,
      commissionBps: r.commission_bps,
      effectiveAt: r.effective_at.toISOString(),
      reason: r.reason,
      createdBy: actorOf(names, r.created_by),
      createdAt: r.created_at.toISOString(),
      inForce: current.has(r.id),
    }));
  }

  private effectiveAt(input: string | undefined, now: Date) {
    const at = input ? new Date(input) : now;
    // History is never rewritten: a change takes effect now or later (a minute of clock skew).
    if (at.getTime() < now.getTime() - 60_000) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'EFFECTIVE_IN_PAST',
        'A change can take effect now or later, not in the past.',
        { effectiveAt: ['must not be in the past'] },
      );
    }
    return at;
  }

  async createFeeRule(adminId: string, input: FeeRuleInput, meta: RequestMeta) {
    const now = this.clock.now();
    const at = this.effectiveAt(input.effectiveAt, now);
    if (input.businessId) {
      const b = await this.db
        .selectFrom('businesses')
        .select('id')
        .where('id', '=', input.businessId)
        .executeTakeFirst();
      if (!b) throw notFound('The business');
    }
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('fee_rules')
        .values({
          mode: input.mode,
          business_id: input.businessId,
          commission_bps: input.commissionBps,
          effective_at: at,
          reason: input.reason,
          created_by: adminId,
        })
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'RULE_EXISTS',
          'A rule for this mode and business already takes effect at that time.',
        );
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.fee_rule_created',
        targetType: 'fee_rule',
        targetId: row.id,
        businessId: input.businessId,
        reason: input.reason,
        diff: { mode: input.mode, commissionBps: input.commissionBps, effectiveAt: at },
        requestId: meta.requestId,
      });
    });
    return this.feeRules();
  }

  async createSetting(adminId: string, input: FinanceSettingInput, meta: RequestMeta) {
    const now = this.clock.now();
    const at = this.effectiveAt(input.effectiveAt, now);
    const limits = FINANCE_SETTING_LIMITS[input.key];
    if (input.value < limits.min || input.value > limits.max) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `The value must be between ${limits.min} and ${limits.max}.`,
        { value: [`must be between ${limits.min} and ${limits.max}`] },
      );
    }
    const before = await setting(this.db, input.key, now);
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('finance_settings')
        .values({
          key: input.key,
          value: input.value,
          effective_at: at,
          reason: input.reason,
          created_by: adminId,
        })
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'RULE_EXISTS',
          'This setting already changes at that time.',
        );
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.setting_changed',
        targetType: 'finance_setting',
        targetId: row.id,
        reason: input.reason,
        diff: { key: input.key, before, after: input.value, effectiveAt: at },
        requestId: meta.requestId,
      });
    });
    return this.settings();
  }

  // Payments ----------------------------------------------------------------------------------

  async listPayments(query: AdminPaymentListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('payments as p')
      .select(['p.id', cursorTs('p.created_at').as('cursor_ts')]);
    if (query.needsAttention !== undefined)
      q = q.where('p.needs_attention', '=', query.needsAttention);
    if (query.status) q = q.where('p.status', '=', query.status);
    if (key) q = q.where(afterCursor('p.created_at', 'p.id', key, 'desc'));
    const rows = await q
      .orderBy('p.created_at', 'desc')
      .orderBy('p.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = toPage(rows, query.limit, (r) => r.id);
    const items = await Promise.all(page.items.map((id) => this.payment(id)));
    return { items, nextCursor: page.nextCursor };
  }

  async payment(id: string, conn: Db | Trx = this.db): Promise<AdminPayment> {
    const p = await conn.selectFrom('payments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p) throw notFound('The payment');
    const refunds = await conn
      .selectFrom('refunds')
      .select(['amount_fils', 'status', 'merchant_order_id'])
      .where('payment_id', '=', id)
      .execute();
    const live = (r: { status: string }) => r.status !== 'failed';
    const sumOf = (rows: { amount_fils: number }[]) => rows.reduce((t, r) => t + r.amount_fils, 0);
    const sellers: AdminPayment['sellers'] = [];
    if (p.order_id) {
      const subs = await conn
        .selectFrom('merchant_orders as mo')
        .innerJoin('businesses as b', 'b.id', 'mo.business_id')
        .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
        .select(['mo.id', 'mo.business_id', 'mo.total_fils', 'b.display_name', 'sf.live_name'])
        .where('mo.order_id', '=', p.order_id)
        .orderBy('mo.id')
        .execute();
      for (const s of subs) {
        const used = sumOf(refunds.filter((r) => live(r) && r.merchant_order_id === s.id));
        sellers.push({
          merchantOrderId: s.id,
          business: {
            id: s.business_id,
            name: businessName(s.live_name as Localized | null, s.display_name as Localized),
          },
          grossFils: s.total_fils,
          refundableFils: REFUNDABLE.includes(p.status) ? Math.max(0, s.total_fils - used) : 0,
        });
      }
    } else if (p.booking_id) {
      const b = await conn
        .selectFrom('bookings as bk')
        .innerJoin('businesses as b', 'b.id', 'bk.business_id')
        .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
        .select(['bk.business_id', 'b.display_name', 'sf.live_name'])
        .where('bk.id', '=', p.booking_id)
        .executeTakeFirstOrThrow();
      sellers.push({
        merchantOrderId: null,
        business: {
          id: b.business_id,
          name: businessName(b.live_name as Localized | null, b.display_name as Localized),
        },
        grossFils: p.amount_fils,
        refundableFils: REFUNDABLE.includes(p.status)
          ? Math.max(0, p.amount_fils - sumOf(refunds.filter(live)))
          : 0,
      });
    }
    return {
      id: p.id,
      targetType: p.target_type,
      orderId: p.order_id,
      bookingId: p.booking_id,
      amountFils: p.amount_fils,
      refundedFils: sumOf(refunds.filter((r) => r.status === 'succeeded')),
      pendingRefundFils: sumOf(refunds.filter((r) => r.status === 'pending')),
      status: p.status,
      needsAttention: p.needs_attention,
      providerRef: p.provider_intent_id,
      createdAt: p.created_at.toISOString(),
      succeededAt: iso(p.succeeded_at),
      sellers,
    };
  }

  // Refund requests (T09, T16) ---------------------------------------------------------------

  async createRefundRequest(adminId: string, input: RefundRequestInput, meta: RequestMeta) {
    const now = this.clock.now();
    let job: RefundJob | null = null;
    const id = await this.db.transaction().execute(async (trx) => {
      await this.lockRefundable(trx, input.paymentId, input.merchantOrderId, input.amountFils);
      const threshold = await setting(trx, 'refund_approval_threshold_fils', now);
      const second = needsSecondApproval(input.amountFils, threshold);
      const request = await trx
        .insertInto('refund_requests')
        .values({
          payment_id: input.paymentId,
          merchant_order_id: input.merchantOrderId,
          amount_fils: input.amountFils,
          reason: input.reason,
          threshold_fils: threshold,
          needs_second_approval: second,
          status: second ? 'pending_approval' : 'approved',
          requested_by: adminId,
          decided_at: second ? null : now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: second ? 'finance.refund_requested' : 'finance.refund_issued',
        targetType: 'payment',
        targetId: input.paymentId,
        reason: input.reason,
        diff: {
          refundRequestId: request.id,
          amountFils: input.amountFils,
          thresholdFils: threshold,
          merchantOrderId: input.merchantOrderId,
        },
        requestId: meta.requestId,
      });
      if (!second) job = await this.issue(trx, request.id, input, now);
      return request.id;
    });
    if (job) await this.payments.issueRefund(job);
    return this.refundRequest(id);
  }

  async decideRefundRequest(adminId: string, id: string, input: RefundDecision, meta: RequestMeta) {
    const now = this.clock.now();
    let job: RefundJob | null = null;
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .selectFrom('refund_requests')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!r) throw notFound('The refund request');
      if (input.decision === 'reject') {
        if (r.status !== 'pending_approval') {
          throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_DECIDED', 'This request was decided.');
        }
        // The requester can withdraw their own request; it is then recorded without a decider.
        await trx
          .updateTable('refund_requests')
          .set({
            status: 'rejected',
            decided_by: r.requested_by === adminId ? null : adminId,
            decided_at: now,
            decision_note: input.note ?? null,
          })
          .where('id', '=', id)
          .execute();
        await writeAudit(trx, {
          actorType: 'admin',
          actorId: adminId,
          action: 'finance.refund_rejected',
          targetType: 'payment',
          targetId: r.payment_id,
          reason: input.note ?? null,
          diff: { refundRequestId: id, amountFils: r.amount_fils },
          requestId: meta.requestId,
        });
        return;
      }
      const check = canApproveRefund({
        requestedBy: r.requested_by,
        approver: adminId,
        status: r.status,
        needsSecondApproval: r.needs_second_approval,
      });
      if (!check.ok) {
        throw check.reason === 'SAME_APPROVER'
          ? new ApiError(
              HttpStatus.FORBIDDEN,
              'SAME_APPROVER',
              'A different admin must approve this refund.',
            )
          : new ApiError(HttpStatus.CONFLICT, 'ALREADY_DECIDED', 'This request was decided.');
      }
      await this.lockRefundable(trx, r.payment_id, r.merchant_order_id, r.amount_fils);
      await trx
        .updateTable('refund_requests')
        .set({
          status: 'approved',
          decided_by: adminId,
          decided_at: now,
          decision_note: input.note ?? null,
        })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.refund_approved',
        targetType: 'payment',
        targetId: r.payment_id,
        reason: input.note ?? null,
        diff: { refundRequestId: id, amountFils: r.amount_fils, requestedBy: r.requested_by },
        requestId: meta.requestId,
      });
      job = await this.issue(
        trx,
        id,
        {
          paymentId: r.payment_id,
          merchantOrderId: r.merchant_order_id,
          amountFils: r.amount_fils,
          reason: r.reason,
        },
        now,
      );
    });
    if (job) await this.payments.issueRefund(job);
    return this.refundRequest(id);
  }

  /** Locks the payment and checks the refund fits what is left for that seller. */
  private async lockRefundable(
    trx: Trx,
    paymentId: string,
    merchantOrderId: string | null,
    amountFils: number,
  ) {
    const p = await trx
      .selectFrom('payments')
      .select(['id', 'status', 'order_id', 'booking_id'])
      .where('id', '=', paymentId)
      .forUpdate()
      .executeTakeFirst();
    if (!p) throw notFound('The payment');
    if (!REFUNDABLE.includes(p.status)) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'NOT_REFUNDABLE',
        'Only a captured payment can be refunded.',
      );
    }
    if (p.order_id) {
      if (!merchantOrderId) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Choose the seller.', {
          merchantOrderId: ['is required for an order payment'],
        });
      }
      const mo = await trx
        .selectFrom('merchant_orders')
        .select(['id'])
        .where('id', '=', merchantOrderId)
        .where('order_id', '=', p.order_id)
        .executeTakeFirst();
      if (!mo) throw notFound('The suborder');
    } else if (merchantOrderId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Not an order payment.', {
        merchantOrderId: ['must be empty for a booking payment'],
      });
    }
    const view = await this.payment(paymentId, trx);
    const seller = view.sellers.find((s) => s.merchantOrderId === merchantOrderId);
    if (!seller || amountFils > seller.refundableFils) throw exceeds();
  }

  private async issue(
    trx: Trx,
    requestId: string,
    input: {
      paymentId: string;
      merchantOrderId: string | null;
      amountFils: number;
      reason: string;
    },
    now: Date,
  ) {
    const p = await trx
      .selectFrom('payments')
      .select(['order_id', 'booking_id'])
      .where('id', '=', input.paymentId)
      .executeTakeFirstOrThrow();
    const job = await this.payments.requestRefund(
      trx,
      {
        paymentId: input.paymentId,
        amountFils: input.amountFils,
        reason: 'admin',
        merchantOrderId: input.merchantOrderId,
        refundRequestId: requestId,
        target: p.booking_id
          ? { type: 'booking', id: p.booking_id }
          : { type: 'order', id: p.order_id as string },
      },
      now,
    );
    if (!job) throw exceeds();
    return job;
  }

  async listRefundRequests(query: RefundRequestListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('refund_requests as r')
      .select(['r.id', cursorTs('r.created_at').as('cursor_ts')]);
    if (query.status) q = q.where('r.status', '=', query.status);
    if (key) q = q.where(afterCursor('r.created_at', 'r.id', key, 'desc'));
    const rows = await q
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = toPage(rows, query.limit, (r) => r.id);
    return {
      items: await Promise.all(page.items.map((id) => this.refundRequest(id))),
      nextCursor: page.nextCursor,
    };
  }

  async refundRequest(id: string): Promise<RefundRequestView> {
    const r = await this.db
      .selectFrom('refund_requests as r')
      .leftJoin('refunds as f', 'f.refund_request_id', 'r.id')
      .leftJoin('payments as p', 'p.id', 'r.payment_id')
      .leftJoin('merchant_orders as mo', 'mo.id', 'r.merchant_order_id')
      .leftJoin('bookings as bk', 'bk.id', 'p.booking_id')
      .leftJoin('businesses as b', (j) =>
        j.on((eb) =>
          eb.or([
            eb('b.id', '=', eb.ref('mo.business_id')),
            eb('b.id', '=', eb.ref('bk.business_id')),
          ]),
        ),
      )
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'r.id',
        'r.payment_id',
        'r.merchant_order_id',
        'r.amount_fils',
        'r.reason',
        'r.threshold_fils',
        'r.needs_second_approval',
        'r.status',
        'r.requested_by',
        'r.decided_by',
        'r.decision_note',
        'r.decided_at',
        'r.created_at',
        'f.id as refund_id',
        'f.status as refund_status',
        'b.id as business_id',
        'b.display_name',
        'sf.live_name',
      ])
      .where('r.id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('The refund request');
    const names = await adminNames(this.db, [r.requested_by, r.decided_by]);
    return {
      id: r.id,
      paymentId: r.payment_id,
      merchantOrderId: r.merchant_order_id,
      business:
        r.business_id && r.display_name
          ? {
              id: r.business_id,
              name: businessName(r.live_name as Localized | null, r.display_name as Localized),
            }
          : null,
      amountFils: r.amount_fils,
      reason: r.reason,
      thresholdFils: r.threshold_fils,
      needsSecondApproval: r.needs_second_approval,
      status: r.status,
      requestedBy: actorOf(names, r.requested_by),
      decidedBy: actorOf(names, r.decided_by),
      decisionNote: r.decision_note,
      decidedAt: iso(r.decided_at),
      createdAt: r.created_at.toISOString(),
      refund: r.refund_id && r.refund_status ? { id: r.refund_id, status: r.refund_status } : null,
    };
  }

  // Earnings, disputes and holds ---------------------------------------------------------------

  async listEarnings(query: AdminEarningListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('merchant_earnings as e')
      .leftJoin('merchant_orders as mo', 'mo.id', 'e.merchant_order_id')
      .innerJoin('businesses as b', 'b.id', 'e.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select((eb) => [
        ...EARNING_COLUMNS,
        'b.display_name',
        'sf.live_name',
        openDisputeExists(eb).as('disputed'),
        cursorTs('e.created_at').as('cursor_ts'),
      ]);
    if (query.businessId) q = q.where('e.business_id', '=', query.businessId);
    if (query.status) q = q.where('e.status', '=', query.status);
    if (key) q = q.where(afterCursor('e.created_at', 'e.id', key, 'desc'));
    const rows = await q
      .orderBy('e.created_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => ({
      ...earningView(r as unknown as EarningRow),
      business: {
        id: r.business_id,
        name: businessName(r.live_name as Localized | null, r.display_name as Localized),
      },
    }));
  }

  async openDispute(adminId: string, input: DisputeInput, meta: RequestMeta) {
    const id = await this.db.transaction().execute(async (trx) => {
      const e = await trx
        .selectFrom('merchant_earnings')
        .select(['id', 'business_id', 'gross_fils', 'refunded_fils'])
        .where('id', '=', input.earningId)
        .forUpdate()
        .executeTakeFirst();
      if (!e) throw notFound('The earning');
      if (input.amountFils > e.gross_fils - e.refunded_fils) throw exceeds();
      const open = await trx
        .selectFrom('disputes')
        .select('id')
        .where('earning_id', '=', e.id)
        .where('status', '=', 'open')
        .executeTakeFirst();
      if (open) {
        throw new ApiError(HttpStatus.CONFLICT, 'DISPUTE_OPEN', 'A dispute is already open.');
      }
      const d = await trx
        .insertInto('disputes')
        .values({
          earning_id: e.id,
          business_id: e.business_id,
          amount_fils: input.amountFils,
          reason: input.reason,
          opened_by: adminId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.dispute_opened',
        targetType: 'dispute',
        targetId: d.id,
        businessId: e.business_id,
        reason: input.reason,
        diff: { earningId: e.id, amountFils: input.amountFils },
        requestId: meta.requestId,
      });
      await trx
        .insertInto('outbox')
        .values({
          event_type: 'dispute.opened',
          payload: JSON.stringify({ disputeId: d.id, businessId: e.business_id }),
          available_at: this.clock.now(),
        })
        .execute();
      return d.id;
    });
    return this.dispute(id);
  }

  async resolveDispute(adminId: string, id: string, input: DisputeResolution, meta: RequestMeta) {
    const now = this.clock.now();
    await this.db.transaction().execute(async (trx) => {
      const d = await trx
        .selectFrom('disputes')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!d) throw notFound('The dispute');
      if (d.status !== 'open') {
        throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_DECIDED', 'This dispute was resolved.');
      }
      if (input.outcome === 'lost') {
        // The provider took the money back: the merchant's share and the commission share return.
        const e = await trx
          .selectFrom('merchant_earnings')
          .select(['booking_id', 'merchant_order_id'])
          .where('id', '=', d.earning_id)
          .executeTakeFirstOrThrow();
        const earning = await earningForRefund(trx, {
          bookingId: e.booking_id,
          merchantOrderId: e.merchant_order_id,
        });
        if (!earning) throw notFound('The earning');
        const left = earning.gross_fils - earning.refunded_fils;
        await reverseEarning(
          trx,
          earning,
          Math.min(d.amount_fils, left),
          { kind: 'chargeback', type: 'dispute', id: d.id },
          now,
        );
      }
      await trx
        .updateTable('disputes')
        .set({
          status: input.outcome,
          resolution_note: input.note,
          resolved_by: adminId,
          resolved_at: now,
        })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: `finance.dispute_${input.outcome}`,
        targetType: 'dispute',
        targetId: id,
        businessId: d.business_id,
        reason: input.note,
        diff: { amountFils: d.amount_fils },
        requestId: meta.requestId,
      });
    });
    return this.dispute(id);
  }

  async listDisputes(query: DisputeListQuery) {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('disputes as d')
      .select(['d.id', cursorTs('d.created_at').as('cursor_ts')]);
    if (query.status) q = q.where('d.status', '=', query.status);
    if (key) q = q.where(afterCursor('d.created_at', 'd.id', key, 'desc'));
    const rows = await q
      .orderBy('d.created_at', 'desc')
      .orderBy('d.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = toPage(rows, query.limit, (r) => r.id);
    return {
      items: await Promise.all(page.items.map((id) => this.dispute(id))),
      nextCursor: page.nextCursor,
    };
  }

  private async dispute(id: string): Promise<DisputeView> {
    const d = await this.db
      .selectFrom('disputes as d')
      .innerJoin('businesses as b', 'b.id', 'd.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'd.id',
        'd.earning_id',
        'd.business_id',
        'd.amount_fils',
        'd.status',
        'd.reason',
        'd.resolution_note',
        'd.opened_by',
        'd.resolved_by',
        'd.resolved_at',
        'd.created_at',
        'b.display_name',
        'sf.live_name',
      ])
      .where('d.id', '=', id)
      .executeTakeFirstOrThrow();
    const names = await adminNames(this.db, [d.opened_by, d.resolved_by]);
    return {
      id: d.id,
      earningId: d.earning_id,
      business: {
        id: d.business_id,
        name: businessName(d.live_name as Localized | null, d.display_name as Localized),
      },
      amountFils: d.amount_fils,
      status: d.status,
      reason: d.reason,
      resolutionNote: d.resolution_note,
      openedBy: actorOf(names, d.opened_by),
      resolvedBy: actorOf(names, d.resolved_by),
      resolvedAt: iso(d.resolved_at),
      createdAt: d.created_at.toISOString(),
    };
  }

  async listHolds(): Promise<PayoutHoldView[]> {
    const rows = await this.db
      .selectFrom('payout_holds as h')
      .innerJoin('businesses as b', 'b.id', 'h.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'h.id',
        'h.business_id',
        'h.reason',
        'h.placed_by',
        'h.released_by',
        'h.released_at',
        'h.created_at',
        'b.display_name',
        'sf.live_name',
      ])
      .orderBy('h.created_at', 'desc')
      .limit(100)
      .execute();
    const names = await adminNames(
      this.db,
      rows.flatMap((r) => [r.placed_by, r.released_by]),
    );
    return rows.map((h) => ({
      id: h.id,
      business: {
        id: h.business_id,
        name: businessName(h.live_name as Localized | null, h.display_name as Localized),
      },
      reason: h.reason,
      placedBy: actorOf(names, h.placed_by),
      releasedBy: actorOf(names, h.released_by),
      releasedAt: iso(h.released_at),
      createdAt: h.created_at.toISOString(),
    }));
  }

  async placeHold(adminId: string, input: PayoutHoldInput, meta: RequestMeta) {
    const b = await this.db
      .selectFrom('businesses')
      .select('id')
      .where('id', '=', input.businessId)
      .executeTakeFirst();
    if (!b) throw notFound('The business');
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('payout_holds')
        .values({ business_id: input.businessId, reason: input.reason, placed_by: adminId })
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) {
        throw new ApiError(HttpStatus.CONFLICT, 'HOLD_EXISTS', 'Payouts are already on hold.');
      }
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.payout_hold_placed',
        targetType: 'payout_hold',
        targetId: row.id,
        businessId: input.businessId,
        reason: input.reason,
        requestId: meta.requestId,
      });
    });
    return this.listHolds();
  }

  async releaseHold(adminId: string, id: string, meta: RequestMeta) {
    await this.db.transaction().execute(async (trx) => {
      const h = await trx
        .updateTable('payout_holds')
        .set({ released_by: adminId, released_at: this.clock.now() })
        .where('id', '=', id)
        .where('released_at', 'is', null)
        .returning(['id', 'business_id'])
        .executeTakeFirst();
      if (!h) throw notFound('The active hold');
      await writeAudit(trx, {
        actorType: 'admin',
        actorId: adminId,
        action: 'finance.payout_hold_released',
        targetType: 'payout_hold',
        targetId: id,
        businessId: h.business_id,
        requestId: meta.requestId,
      });
    });
    return this.listHolds();
  }
}
