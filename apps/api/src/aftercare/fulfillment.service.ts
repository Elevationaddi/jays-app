import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminOrderListQuery,
  CustomerCancelRequest,
  FulfillmentActionRequest,
  MerchantOrderView,
  OrderView,
} from '@jays/contracts';
import type { Database, Db } from '@jays/db';
import { customerCanCancel, fulfillmentTransition, type SuborderStatus } from '@jays/domain';
import type { Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { afterCursor, cursorTs, decodeCursor, toPage } from '../common/pagination.js';
import type { RequestMeta } from '../common/request-context.js';
import { DB } from '../common/tokens.js';
import { OrdersService } from '../commerce/orders.service.js';
import { DELIVERY_PARTNER, type DeliveryPartner } from '../commerce/delivery-partner.js';
import { PaymentsService, type RefundJob } from '../payments/payments.service.js';

type Trx = Transaction<Database>;
type Localized = { en: string; ar: string };

export const notFound = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The order was not found.');

/**
 * Suborder fulfillment (docs/05-workflows.md, product checkout step 5; ADR-0016): the merchant
 * processes, ships with tracking and marks delivered, or cancels before dispatch with a full
 * refund of that suborder. A customer can cancel a suborder the merchant has not started. Every
 * change is locked, version-checked against the status the actor saw, recorded in the timeline,
 * audited and announced through the outbox.
 */
@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(DELIVERY_PARTNER) private readonly partner: DeliveryPartner | null,
  ) {}

  async merchantAction(
    businessId: string,
    userId: string,
    merchantOrderId: string,
    body: FulfillmentActionRequest,
    meta: RequestMeta,
  ): Promise<MerchantOrderView> {
    const now = this.clock.now();
    const refund = await this.db.transaction().execute(async (trx) => {
      const mo = await trx
        .selectFrom('merchant_orders')
        .select(['id', 'order_id', 'status', 'total_fils', 'delivery_snapshot'])
        .where('id', '=', merchantOrderId)
        .where('business_id', '=', businessId)
        .forUpdate()
        .executeTakeFirst();
      if (!mo) throw notFound();
      if (mo.status !== body.expectedStatus) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'The order changed since you loaded it. Reload and try again.',
        );
      }
      const next = fulfillmentTransition(mo.status as SuborderStatus, body.action);
      if (!next) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          `A ${mo.status} order cannot be marked ${body.action}.`,
        );
      }
      let job: RefundJob | null = null;
      // Shipping through the delivery partner (ADR-0029): it supplies the tracking. A real
      // adapter must be idempotent per suborder, because this transaction can still roll back.
      let tracking = {
        carrier: body.carrier ?? null,
        trackingNumber: body.trackingNumber ?? null,
        trackingUrl: body.trackingUrl ?? null,
      };
      let partnerName: 'mock' | null = null;
      if (body.action === 'ship' && body.usePartner) {
        if (!this.partner) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'DELIVERY_PARTNER_UNAVAILABLE',
            'No delivery partner is set up. Enter the carrier and tracking number yourself.',
          );
        }
        const d = mo.delivery_snapshot as { emirate: string; method?: 'standard' | 'express' };
        const shipment = await this.partner.createShipment({
          merchantOrderId: mo.id,
          businessId,
          emirate: d.emirate,
          method: d.method ?? 'standard',
        });
        tracking = shipment;
        partnerName = this.partner.name;
      }
      if (body.action === 'cancel') {
        job = await this.cancel(trx, mo, 'merchant_request', 'business_cancellation', now);
      } else {
        await trx
          .updateTable('merchant_orders')
          .set({
            status: next,
            ...(body.action === 'process' ? { processing_at: now } : {}),
            ...(body.action === 'ship'
              ? {
                  shipped_at: now,
                  carrier: tracking.carrier,
                  tracking_number: tracking.trackingNumber,
                  tracking_url: tracking.trackingUrl,
                  delivery_partner: partnerName,
                }
              : {}),
            ...(body.action === 'deliver' ? { delivered_at: now } : {}),
          })
          .where('id', '=', mo.id)
          .execute();
      }
      await this.event(trx, mo.id, next, 'user', userId, body.reason ?? null);
      if (next === 'shipped' || next === 'delivered' || next === 'canceled') {
        await this.outbox(
          trx,
          `order.${next}`,
          { merchantOrderId: mo.id, orderId: mo.order_id },
          now,
        );
      }
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: `order.${body.action}`,
        targetType: 'merchant_order',
        targetId: mo.id,
        businessId,
        reason: body.reason ?? null,
        diff: {
          from: mo.status,
          to: next,
          ...(body.action === 'ship'
            ? {
                carrier: tracking.carrier,
                trackingNumber: tracking.trackingNumber,
                partner: partnerName,
              }
            : {}),
        },
        requestId: meta.requestId,
      });
      return job;
    });
    if (refund) await this.payments.issueRefund(refund);
    return this.orders.getForBusiness(businessId, merchantOrderId);
  }

  async customerCancel(
    userId: string,
    orderId: string,
    body: CustomerCancelRequest,
    meta: RequestMeta,
  ): Promise<OrderView> {
    const now = this.clock.now();
    const refund = await this.db.transaction().execute(async (trx) => {
      const mo = await trx
        .selectFrom('merchant_orders as mo')
        .innerJoin('orders as o', 'o.id', 'mo.order_id')
        .select(['mo.id', 'mo.order_id', 'mo.status', 'mo.total_fils', 'mo.business_id'])
        .where('mo.id', '=', body.merchantOrderId)
        .where('mo.order_id', '=', orderId)
        .where('o.user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!mo) throw notFound();
      if (!customerCanCancel(mo.status as SuborderStatus)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'This part of the order can no longer be canceled. You can request a return after delivery.',
        );
      }
      const job = await this.cancel(trx, mo, 'customer_request', 'customer_cancellation', now);
      await this.event(trx, mo.id, 'canceled', 'user', userId, body.reason ?? null);
      await this.outbox(
        trx,
        'order.canceled',
        { merchantOrderId: mo.id, orderId, by: 'customer' },
        now,
      );
      await writeAudit(trx, {
        actorType: 'user',
        actorId: userId,
        action: 'order.customer_cancel',
        targetType: 'merchant_order',
        targetId: mo.id,
        businessId: mo.business_id,
        reason: body.reason ?? null,
        requestId: meta.requestId,
      });
      return job;
    });
    if (refund) await this.payments.issueRefund(refund);
    return this.orders.getForUser(userId, orderId);
  }

  /**
   * Cancels a suborder before dispatch: the goods never left, so stock goes straight back on the
   * shelf, and the whole suborder (items and delivery) is refunded.
   */
  private async cancel(
    trx: Trx,
    mo: { id: string; order_id: string; total_fils: number },
    cancelReason: 'merchant_request' | 'customer_request',
    refundReason: 'business_cancellation' | 'customer_cancellation',
    now: Date,
  ): Promise<RefundJob | null> {
    await trx
      .updateTable('merchant_orders')
      .set({ status: 'canceled', cancel_reason: cancelReason, canceled_at: now })
      .where('id', '=', mo.id)
      .execute();
    const items = await trx
      .selectFrom('order_items')
      .select(['variant_id', 'business_id', 'qty'])
      .where('merchant_order_id', '=', mo.id)
      .orderBy('variant_id')
      .execute();
    for (const item of items) {
      const v = await trx
        .updateTable('variants')
        .set((eb) => ({ stock_on_hand: eb('stock_on_hand', '+', item.qty) }))
        .where('id', '=', item.variant_id)
        .returning('stock_on_hand')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('stock_movements')
        .values({
          variant_id: item.variant_id,
          business_id: item.business_id,
          delta: item.qty,
          reason: 'restock',
          note: 'Order canceled before dispatch',
          actor_type: 'system',
          actor_id: null,
          on_hand_after: v.stock_on_hand,
        })
        .execute();
    }
    const payment = await trx
      .selectFrom('payments')
      .select('id')
      .where('order_id', '=', mo.order_id)
      .executeTakeFirst();
    if (!payment) return null;
    const job = await this.payments.requestRefund(
      trx,
      {
        paymentId: payment.id,
        amountFils: mo.total_fils,
        reason: refundReason,
        target: { type: 'order', id: mo.order_id },
        merchantOrderId: mo.id,
      },
      now,
    );
    if (!job) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'NOT_REFUNDABLE',
        'The payment for this order cannot be refunded automatically. Contact support.',
      );
    }
    return job;
  }

  async event(
    trx: Trx,
    merchantOrderId: string,
    status: string,
    actorType: 'user' | 'admin' | 'system',
    actorId: string | null,
    note: string | null,
  ) {
    await trx
      .insertInto('merchant_order_events')
      .values({
        merchant_order_id: merchantOrderId,
        status: status as never,
        actor_type: actorType,
        actor_id: actorId,
        note,
      })
      .execute();
  }

  async outbox(trx: Trx, type: string, payload: Record<string, unknown>, now: Date) {
    await trx
      .insertInto('outbox')
      .values({ event_type: type, payload: JSON.stringify(payload), available_at: now })
      .execute();
  }

  /** Cross-merchant fulfillment monitoring (docs/04-admin.md, /admin/orders). */
  async adminList(query: AdminOrderListQuery) {
    const key = decodeCursor(query.cursor);
    const twoDaysAgo = new Date(this.clock.now().getTime() - 2 * 86_400_000);
    let q = this.db
      .selectFrom('merchant_orders as mo')
      .innerJoin('orders as o', 'o.id', 'mo.order_id')
      .innerJoin('businesses as b', 'b.id', 'mo.business_id')
      .leftJoin('storefronts as sf', 'sf.business_id', 'b.id')
      .select([
        'mo.id',
        'mo.order_id',
        'mo.status',
        'mo.total_fils',
        'mo.carrier',
        'mo.tracking_number',
        'mo.shipped_at',
        'mo.delivered_at',
        'mo.created_at',
        'mo.business_id',
        'o.paid_at',
        'b.display_name',
        'sf.live_name',
        cursorTs('mo.created_at').as('cursor_ts'),
        (eb) =>
          eb
            .selectFrom('order_items')
            .select((e) => e.fn.sum<string>('qty').as('n'))
            .whereRef('merchant_order_id', '=', 'mo.id')
            .as('item_count'),
        (eb) =>
          eb
            .exists(
              eb
                .selectFrom('return_requests as rr')
                .select('rr.id')
                .whereRef('rr.merchant_order_id', '=', 'mo.id')
                .where('rr.status', 'in', ['requested', 'approved', 'received', 'refund_pending']),
            )
            .as('open_return'),
      ])
      .where('mo.status', '<>', 'pending_payment');
    if (query.status) q = q.where('mo.status', '=', query.status);
    if (query.stuck) {
      q = q.where('mo.status', 'in', ['paid', 'processing']).where('o.paid_at', '<', twoDaysAgo);
    }
    if (key) q = q.where(afterCursor('mo.created_at', 'mo.id', key, 'desc'));
    const rows = await q
      .orderBy('mo.created_at', 'desc')
      .orderBy('mo.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      orderId: r.order_id,
      business: {
        id: r.business_id,
        name: (r.live_name ?? r.display_name) as Localized,
      },
      status: r.status,
      totalFils: r.total_fils,
      itemCount: Number(r.item_count ?? 0),
      carrier: r.carrier,
      trackingNumber: r.tracking_number,
      paidAt: r.paid_at?.toISOString() ?? null,
      shippedAt: r.shipped_at?.toISOString() ?? null,
      deliveredAt: r.delivered_at?.toISOString() ?? null,
      openReturn: Boolean(r.open_return),
      createdAt: r.created_at.toISOString(),
    }));
  }
}
