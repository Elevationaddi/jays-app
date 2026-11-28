import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  ReturnActionRequest,
  ReturnListQuery,
  ReturnRequestInput,
  ReturnView,
} from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import {
  RETURN_WINDOW_DAYS,
  returnAmount,
  returnTransition,
  type ReturnStatus,
  withinReturnWindow,
} from '@jays/domain';
import type { Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { PaymentsService, type RefundJob } from '../payments/payments.service.js';

type Trx = Transaction<Database>;
type Localized = { en: string; ar: string };
type Snapshot = { title: Localized; variantName: Localized };

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The return was not found.');

/**
 * Returns after delivery (docs/05-workflows.md; ADR-0016). A customer asks to return delivered
 * units within the return window; the merchant approves or rejects, then marks the goods received,
 * which refunds what those units paid (never delivery). The return becomes refunded or
 * refund_failed only when the provider confirms the refund by webhook. Restocking returned goods
 * is a separate stock adjustment, because returned goods may not be sellable.
 */
@Injectable()
export class ReturnsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  async create(
    userId: string,
    orderId: string,
    body: ReturnRequestInput,
    meta: RequestMeta,
  ): Promise<ReturnView> {
    const now = this.clock.now();
    const ids = body.items.map((i) => i.orderItemId);
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Each item once, please.', {
        items: ['repeat an item'],
      });
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const mo = await trx
        .selectFrom('merchant_orders as mo')
        .innerJoin('orders as o', 'o.id', 'mo.order_id')
        .select(['mo.id', 'mo.status', 'mo.delivered_at', 'mo.business_id'])
        .where('mo.id', '=', body.merchantOrderId)
        .where('mo.order_id', '=', orderId)
        .where('o.user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!mo) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The order was not found.');
      if (mo.status !== 'delivered' || !mo.delivered_at) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'NOT_DELIVERED',
          'Returns can be requested once the order is delivered.',
        );
      }
      if (!withinReturnWindow(mo.delivered_at, now, RETURN_WINDOW_DAYS)) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'RETURN_WINDOW_CLOSED',
          `Returns are accepted for ${RETURN_WINDOW_DAYS} days after delivery.`,
        );
      }
      const open = await trx
        .selectFrom('return_requests')
        .select('id')
        .where('merchant_order_id', '=', mo.id)
        .where('status', 'in', ['requested', 'approved', 'received', 'refund_pending'])
        .executeTakeFirst();
      if (open) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'RETURN_OPEN',
          'A return for this part of the order is already in progress.',
        );
      }
      const items = await trx
        .selectFrom('order_items')
        .select(['id', 'qty', 'line_total_fils', 'discount_fils'])
        .where('merchant_order_id', '=', mo.id)
        .where('id', 'in', ids)
        .execute();
      if (items.length !== ids.length) throw notFound();
      const returned = await trx
        .selectFrom('return_items as ri')
        .innerJoin('return_requests as rr', 'rr.id', 'ri.return_request_id')
        .select(['ri.order_item_id', (eb) => eb.fn.sum<string>('ri.qty').as('qty')])
        .where('ri.order_item_id', 'in', ids)
        .where('rr.status', '<>', 'rejected')
        .groupBy('ri.order_item_id')
        .execute();
      const already = new Map(returned.map((r) => [r.order_item_id, Number(r.qty)]));
      const lines = body.items.map((want) => {
        const item = items.find((i) => i.id === want.orderItemId)!;
        const alreadyReturnedQty = already.get(item.id) ?? 0;
        if (alreadyReturnedQty + want.qty > item.qty) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'RETURN_EXCEEDS_PURCHASE',
            'You cannot return more units than you bought.',
          );
        }
        const amount = returnAmount(
          {
            qty: item.qty,
            lineTotalFils: item.line_total_fils,
            discountFils: item.discount_fils,
            alreadyReturnedQty,
          },
          want.qty,
        );
        return { orderItemId: item.id, qty: want.qty, amount };
      });
      const total = lines.reduce((sum, l) => sum + l.amount, 0);
      const rr = await trx
        .insertInto('return_requests')
        .values({
          merchant_order_id: mo.id,
          order_id: orderId,
          business_id: mo.business_id,
          user_id: userId,
          reason: body.reason,
          amount_fils: total,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('return_items')
        .values(
          lines.map((l) => ({
            return_request_id: rr.id,
            order_item_id: l.orderItemId,
            qty: l.qty,
            amount_fils: l.amount,
          })),
        )
        .execute();
      await outbox(
        trx,
        'return.requested',
        { returnId: rr.id, orderId, merchantOrderId: mo.id },
        now,
      );
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'return.request',
        targetType: 'return_request',
        targetId: rr.id,
        businessId: mo.business_id,
        reason: body.reason,
        diff: { amountFils: total, items: lines.map((l) => ({ id: l.orderItemId, qty: l.qty })) },
        requestId: meta.requestId,
      });
      return rr.id;
    });
    return this.get({ userId }, id);
  }

  async merchantAction(
    businessId: string,
    userId: string,
    returnId: string,
    body: ReturnActionRequest,
    meta: RequestMeta,
  ): Promise<ReturnView> {
    const now = this.clock.now();
    const job = await this.db.transaction().execute(async (trx) => {
      const rr = await trx
        .selectFrom('return_requests')
        .select(['id', 'status', 'order_id', 'merchant_order_id', 'amount_fils'])
        .where('id', '=', returnId)
        .where('business_id', '=', businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!rr) throw notFound();
      const next = returnTransition(rr.status as ReturnStatus, body.action);
      if (!next) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          `A ${rr.status.replace('_', ' ')} return cannot be ${body.action}d.`,
        );
      }
      let refund: RefundJob | null = null;
      if (body.action === 'approve' || body.action === 'reject') {
        await trx
          .updateTable('return_requests')
          .set({
            status: next,
            decision_reason: body.reason ?? null,
            decided_by: userId,
            decided_at: now,
          })
          .where('id', '=', rr.id)
          .execute();
        await outbox(
          trx,
          next === 'approved' ? 'return.approved' : 'return.rejected',
          { returnId: rr.id, orderId: rr.order_id, merchantOrderId: rr.merchant_order_id },
          now,
        );
      } else {
        const payment = await trx
          .selectFrom('payments')
          .select('id')
          .where('order_id', '=', rr.order_id)
          .executeTakeFirstOrThrow();
        refund = await this.payments.requestRefund(
          trx,
          {
            paymentId: payment.id,
            amountFils: rr.amount_fils,
            reason: 'return',
            target: { type: 'order', id: rr.order_id },
            merchantOrderId: rr.merchant_order_id,
            returnRequestId: rr.id,
          },
          now,
        );
        await trx
          .updateTable('return_requests')
          .set({
            status: refund ? 'refund_pending' : 'refund_failed',
            received_at: now,
            refund_id: refund?.refundId ?? null,
          })
          .where('id', '=', rr.id)
          .execute();
        if (!refund) {
          // The goods are back but the money cannot go automatically: operations must act.
          await trx
            .updateTable('payments')
            .set({ needs_attention: true })
            .where('id', '=', payment.id)
            .execute();
          await outbox(
            trx,
            'payment.manual_exception',
            { returnId: rr.id, paymentId: payment.id },
            now,
          );
        }
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: `return.${body.action}`,
        targetType: 'return_request',
        targetId: rr.id,
        businessId,
        reason: body.reason ?? null,
        diff: { from: rr.status, to: next, amountFils: rr.amount_fils },
        requestId: meta.requestId,
      });
      return refund;
    });
    if (job) await this.payments.issueRefund(job);
    return this.get({ businessId }, returnId);
  }

  listForUser(userId: string, query: ReturnListQuery) {
    return this.list({ userId }, query);
  }

  listForBusiness(businessId: string, query: ReturnListQuery) {
    return this.list({ businessId }, query);
  }

  private async list(
    scope: { userId?: string; businessId?: string },
    query: ReturnListQuery,
  ): Promise<{ items: ReturnView[]; nextCursor: string | null }> {
    const key = decodeCursor(query.cursor);
    let q = this.db
      .selectFrom('return_requests as rr')
      .select(['rr.id', cursorTs('rr.created_at').as('cursor_ts')]);
    if (scope.userId) q = q.where('rr.user_id', '=', scope.userId);
    if (scope.businessId) q = q.where('rr.business_id', '=', scope.businessId);
    if (query.status) q = q.where('rr.status', '=', query.status);
    if (key) q = q.where(afterCursor('rr.created_at', 'rr.id', key, 'desc'));
    const rows = await q
      .orderBy('rr.created_at', 'desc')
      .orderBy('rr.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = toPage(rows, query.limit, (r) => r.id);
    const views = await this.views(page.items);
    return { items: views, nextCursor: page.nextCursor };
  }

  async get(scope: { userId?: string; businessId?: string }, returnId: string) {
    let q = this.db.selectFrom('return_requests').select('id').where('id', '=', returnId);
    if (scope.userId) q = q.where('user_id', '=', scope.userId);
    if (scope.businessId) q = q.where('business_id', '=', scope.businessId);
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    const [view] = await this.views([row.id]);
    return view!;
  }

  private async views(ids: string[]): Promise<ReturnView[]> {
    if (ids.length === 0) return [];
    const [rows, items] = await Promise.all([
      this.db
        .selectFrom('return_requests as rr')
        .innerJoin('businesses as b', 'b.id', 'rr.business_id')
        .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
        .select([
          'rr.id',
          'rr.merchant_order_id',
          'rr.order_id',
          'rr.business_id',
          'rr.status',
          'rr.reason',
          'rr.amount_fils',
          'rr.decision_reason',
          'rr.decided_at',
          'rr.received_at',
          'rr.created_at',
          'b.display_name',
          'sf.live_name',
        ])
        .where('rr.id', 'in', ids)
        .execute(),
      this.db
        .selectFrom('return_items as ri')
        .innerJoin('order_items as oi', 'oi.id', 'ri.order_item_id')
        .select([
          'ri.return_request_id',
          'ri.order_item_id',
          'ri.qty',
          'ri.amount_fils',
          'oi.snapshot',
        ])
        .where('ri.return_request_id', 'in', ids)
        .orderBy('oi.variant_id')
        .execute(),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id)!;
      return {
        id: r.id,
        merchantOrderId: r.merchant_order_id,
        orderId: r.order_id,
        business: { id: r.business_id, name: (r.live_name ?? r.display_name) as Localized },
        status: r.status,
        reason: r.reason,
        amountFils: r.amount_fils,
        items: items
          .filter((i) => i.return_request_id === id)
          .map((i) => {
            const s = i.snapshot as Snapshot;
            return {
              orderItemId: i.order_item_id,
              title: s.title,
              variantName: s.variantName,
              qty: i.qty,
              amountFils: i.amount_fils,
            };
          }),
        decisionReason: r.decision_reason,
        decidedAt: r.decided_at?.toISOString() ?? null,
        receivedAt: r.received_at?.toISOString() ?? null,
        createdAt: r.created_at.toISOString(),
      };
    });
  }
}

async function outbox(trx: Trx, type: string, payload: Record<string, unknown>, now: Date) {
  await trx
    .insertInto('outbox')
    .values({ event_type: type, payload: JSON.stringify(payload), available_at: now })
    .execute();
}
