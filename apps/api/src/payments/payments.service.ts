import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Db } from '@jays/db';
import { sql, type Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderEvent } from './provider.js';

type Trx = Transaction<Database>;

interface LateRefund {
  paymentId: string;
  refundId: string;
  intentId: string;
  amountFils: number;
  orderId: string;
}

/**
 * Applies verified provider webhooks (docs/05-workflows.md, product checkout steps 4 and the
 * timeout rules). Each event id is recorded once, in the same transaction as its effects, so a
 * replay is a no-op (T06). Locks: the order row first, then variant rows in ascending id order.
 *
 * - succeeded, order still pending: reservations become stock deductions with `sale` movements,
 *   the order and its suborders become paid, bought lines leave the cart, events are queued.
 * - succeeded, order already expired or failed (late payment): the money is refunded
 *   automatically; if the refund cannot be made the payment is flagged for operations.
 * - failed: reservations are released and the order fails.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const now = this.clock.now();
    const event = rawBody ? this.provider.verifyWebhook(rawBody, signature, now) : null;
    if (!event || !rawBody) {
      this.log.warn({ signaturePresent: !!signature }, 'webhook signature verification failed');
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_SIGNATURE',
        'Webhook signature is not valid.',
      );
    }
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    let lateRefund: LateRefund | null = null;
    const duplicate = await this.db.transaction().execute(async (trx) => {
      const recorded = await trx
        .insertInto('webhook_events')
        .values({
          provider: this.provider.name,
          event_id: event.id,
          event_type: event.type,
          payload_hash: payloadHash,
        })
        .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!recorded) return true;
      const outcome = await this.apply(trx, event, now);
      lateRefund = outcome.lateRefund ?? null;
      await trx
        .updateTable('webhook_events')
        .set({ outcome: outcome.result })
        .where('id', '=', recorded.id)
        .execute();
      return false;
    });
    if (lateRefund) await this.issueLateRefund(lateRefund);
    return { received: true as const, duplicate };
  }

  private async apply(
    trx: Trx,
    event: ProviderEvent,
    now: Date,
  ): Promise<{ result: string; lateRefund?: LateRefund }> {
    if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
      return this.applyRefund(trx, event);
    }
    if (
      event.type !== 'payment_intent.succeeded' &&
      event.type !== 'payment_intent.payment_failed'
    ) {
      return { result: 'ignored_type' };
    }
    const payment = await trx
      .selectFrom('payments')
      .select(['id', 'order_id', 'amount_fils', 'currency', 'status'])
      .where('provider', '=', this.provider.name)
      .where('provider_intent_id', '=', event.intentId)
      .executeTakeFirst();
    if (!payment || !payment.order_id) return { result: 'unknown_intent' };
    const order = await trx
      .selectFrom('orders')
      .select(['id', 'status', 'cart_id', 'user_id'])
      .where('id', '=', payment.order_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await trx
      .selectFrom('payments')
      .select('id')
      .where('id', '=', payment.id)
      .forUpdate()
      .execute();
    if (event.amountFils !== payment.amount_fils || event.currency !== payment.currency) {
      // Never settle a different amount than the order total; flag it for a human.
      await trx
        .updateTable('payments')
        .set({ needs_attention: true })
        .where('id', '=', payment.id)
        .execute();
      return { result: 'amount_mismatch' };
    }

    if (event.type === 'payment_intent.payment_failed') {
      if (payment.status !== 'requires_payment') return { result: 'already_settled' };
      await trx
        .updateTable('payments')
        .set({ status: 'failed', failure_code: event.failureCode ?? 'failed' })
        .where('id', '=', payment.id)
        .execute();
      if (order.status === 'pending_payment') {
        await sql`SELECT release_order_reservations(${order.id}::uuid, 'payment_failed')`.execute(
          trx,
        );
        await trx
          .updateTable('orders')
          .set({ status: 'failed', failed_at: now })
          .where('id', '=', order.id)
          .execute();
        await trx
          .updateTable('merchant_orders')
          .set({ status: 'canceled', cancel_reason: 'payment_failed' })
          .where('order_id', '=', order.id)
          .where('status', '=', 'pending_payment')
          .execute();
        await this.outbox(trx, 'order.payment_failed', { orderId: order.id }, now);
      }
      return { result: 'payment_failed' };
    }

    // payment_intent.succeeded
    if (payment.status !== 'requires_payment' && payment.status !== 'failed') {
      return { result: 'already_settled' };
    }
    await trx
      .updateTable('payments')
      .set({ status: 'succeeded', succeeded_at: now, failure_code: null })
      .where('id', '=', payment.id)
      .execute();
    if (order.status !== 'pending_payment') {
      // Late payment: the stock was already released. Refund it (docs/05-workflows.md).
      const refund = await trx
        .insertInto('refunds')
        .values({
          payment_id: payment.id,
          amount_fils: payment.amount_fils,
          reason: 'late_payment',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('payments')
        .set({ status: 'refund_pending' })
        .where('id', '=', payment.id)
        .execute();
      await this.outbox(
        trx,
        'payment.late_payment_refund_requested',
        { orderId: order.id, paymentId: payment.id },
        now,
      );
      return {
        result: 'late_payment_refund_requested',
        lateRefund: {
          paymentId: payment.id,
          refundId: refund.id,
          intentId: event.intentId,
          amountFils: payment.amount_fils,
          orderId: order.id,
        },
      };
    }
    const reservations = await trx
      .selectFrom('reservations')
      .select(['id', 'variant_id', 'business_id', 'qty'])
      .where('order_id', '=', order.id)
      .where('status', '=', 'active')
      .orderBy('variant_id')
      .execute();
    if (reservations.length > 0) {
      await trx
        .selectFrom('variants')
        .select('id')
        .where(
          'id',
          'in',
          reservations.map((r) => r.variant_id),
        )
        .orderBy('id')
        .forUpdate()
        .execute();
    }
    for (const r of reservations) {
      const v = await trx
        .updateTable('variants')
        .set({
          stock_on_hand: sql<number>`stock_on_hand - ${r.qty}`,
          stock_reserved: sql<number>`stock_reserved - ${r.qty}`,
        })
        .where('id', '=', r.variant_id)
        .returning('stock_on_hand')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('stock_movements')
        .values({
          variant_id: r.variant_id,
          business_id: r.business_id,
          delta: -r.qty,
          reason: 'sale',
          order_id: order.id,
          actor_type: 'system',
          actor_id: null,
          on_hand_after: v.stock_on_hand,
        })
        .execute();
    }
    await trx
      .updateTable('reservations')
      .set({ status: 'converted' })
      .where('order_id', '=', order.id)
      .where('status', '=', 'active')
      .execute();
    await trx
      .updateTable('orders')
      .set({ status: 'paid', paid_at: now })
      .where('id', '=', order.id)
      .execute();
    const merchants = await trx
      .updateTable('merchant_orders')
      .set({ status: 'paid' })
      .where('order_id', '=', order.id)
      .where('status', '=', 'pending_payment')
      .returning(['id', 'business_id'])
      .execute();
    // Bought items leave the cart; anything added since stays.
    await trx
      .deleteFrom('cart_items')
      .where('cart_id', '=', order.cart_id)
      .where('variant_id', 'in', (eb) =>
        eb.selectFrom('order_items').select('variant_id').where('order_id', '=', order.id),
      )
      .execute();
    await this.outbox(trx, 'order.paid', { orderId: order.id, userId: order.user_id }, now);
    for (const m of merchants) {
      await this.outbox(
        trx,
        'merchant_order.paid',
        { merchantOrderId: m.id, businessId: m.business_id },
        now,
      );
    }
    return { result: 'paid' };
  }

  private async applyRefund(trx: Trx, event: ProviderEvent): Promise<{ result: string }> {
    if (!event.refundId) return { result: 'unknown_refund' };
    const refund = await trx
      .selectFrom('refunds')
      .select(['id', 'payment_id', 'status'])
      .where('provider_ref', '=', event.refundId)
      .forUpdate()
      .executeTakeFirst();
    if (!refund) return { result: 'unknown_refund' };
    if (refund.status !== 'pending') return { result: 'already_settled' };
    const ok = event.type === 'refund.succeeded';
    await trx
      .updateTable('refunds')
      .set({
        status: ok ? 'succeeded' : 'failed',
        failure_code: ok ? null : (event.failureCode ?? 'failed'),
      })
      .where('id', '=', refund.id)
      .execute();
    await trx
      .updateTable('payments')
      .set(ok ? { status: 'refunded' } : { status: 'refund_failed', needs_attention: true })
      .where('id', '=', refund.payment_id)
      .execute();
    return { result: ok ? 'refunded' : 'refund_failed' };
  }

  /** Calls the provider outside the webhook transaction; failures are flagged, never hidden. */
  private async issueLateRefund(r: LateRefund) {
    try {
      const { refundId } = await this.provider.refund({
        intentId: r.intentId,
        amountFils: r.amountFils,
        idempotencyKey: `refund-${r.refundId}`,
      });
      await this.db
        .updateTable('refunds')
        .set({ provider_ref: refundId })
        .where('id', '=', r.refundId)
        .where('provider_ref', 'is', null)
        .execute();
    } catch (error) {
      this.log.error(
        { err: error, orderId: r.orderId },
        'automatic refund of a late payment failed',
      );
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('refunds')
          .set({ status: 'failed', failure_code: 'provider_refused' })
          .where('id', '=', r.refundId)
          .where('status', '=', 'pending')
          .execute();
        await trx
          .updateTable('payments')
          .set({ status: 'refund_failed', needs_attention: true })
          .where('id', '=', r.paymentId)
          .execute();
        await this.outbox(
          trx,
          'payment.manual_exception',
          { orderId: r.orderId, paymentId: r.paymentId },
          this.clock.now(),
        );
        await writeAudit(trx, {
          actorType: 'system',
          actorId: null,
          action: 'payment.late_refund_failed',
          targetType: 'payment',
          targetId: r.paymentId,
          diff: { orderId: r.orderId, amountFils: r.amountFils },
        });
      });
    }
  }

  private async outbox(trx: Trx, type: string, payload: Record<string, unknown>, now: Date) {
    await trx
      .insertInto('outbox')
      .values({ event_type: type, payload: JSON.stringify(payload), available_at: now })
      .execute();
  }
}
