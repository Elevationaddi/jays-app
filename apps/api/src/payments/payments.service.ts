import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Db } from '@jays/db';
import { sql, type Transaction } from 'kysely';
import { writeAudit } from '../common/audit.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ApiError } from '../common/error.filter.js';
import { DB } from '../common/tokens.js';
import { paymentStatusAfterRefunds, postings } from '@jays/domain';
import {
  earningForRefund,
  post,
  recordBookingCapture,
  recordOrderCapture,
  reverseEarning,
} from '../finance/ledger.js';
import { applyPayoutEvent } from '../finance/payout-events.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderEvent } from './provider.js';

type Trx = Transaction<Database>;

/** A refund recorded in the database, to be sent to the provider once the transaction commits. */
export interface RefundJob {
  paymentId: string;
  refundId: string;
  intentId: string;
  amountFils: number;
  target: { type: 'order' | 'booking'; id: string };
}

export type RefundReason =
  'late_payment' | 'customer_cancellation' | 'business_cancellation' | 'admin' | 'return';

type LateRefund = RefundJob;

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
 *
 * Bookings (docs/05-workflows.md, appointment steps 3-4): a success while the hold is still valid
 * confirms the booking; a success after the hold ended is refunded in full; a failure ends the
 * hold so the time is free again. Refunds for cancellations go through `requestRefund`.
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
    return this.ingest(event, payloadHash, now);
  }

  /**
   * Records and applies one provider event exactly once. Used by the webhook endpoint and by
   * reconciliation, which replays an event the provider recorded but never delivered (T15).
   */
  async ingest(event: ProviderEvent, payloadHash: string, now = this.clock.now()) {
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
    if (lateRefund) await this.issueRefund(lateRefund);
    return { received: true as const, duplicate };
  }

  private async apply(
    trx: Trx,
    event: ProviderEvent,
    now: Date,
  ): Promise<{ result: string; lateRefund?: LateRefund }> {
    if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
      return this.applyRefund(trx, event, now);
    }
    if (event.type === 'payout.paid' || event.type === 'payout.failed') {
      return applyPayoutEvent(trx, event, now);
    }
    if (
      event.type !== 'payment_intent.succeeded' &&
      event.type !== 'payment_intent.payment_failed'
    ) {
      return { result: 'ignored_type' };
    }
    const payment = await trx
      .selectFrom('payments')
      .select(['id', 'order_id', 'booking_id', 'amount_fils', 'currency', 'status'])
      .where('provider', '=', this.provider.name)
      .where('provider_intent_id', '=', event.intentId)
      .executeTakeFirst();
    if (payment?.booking_id) {
      return this.applyBooking(trx, { ...payment, booking_id: payment.booking_id }, event, now);
    }
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
      await post(
        trx,
        {
          kind: 'late_capture',
          sourceType: 'payment',
          sourceId: payment.id,
          businessId: null,
          occurredAt: now,
        },
        postings.lateCapture(payment.amount_fils),
      );
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
          target: { type: 'order', id: order.id },
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
    await recordOrderCapture(trx, order.id, payment.id, now);
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

  private async applyRefund(
    trx: Trx,
    event: ProviderEvent,
    now: Date,
  ): Promise<{ result: string }> {
    if (!event.refundId) return { result: 'unknown_refund' };
    const refund = await trx
      .selectFrom('refunds')
      .select([
        'id',
        'payment_id',
        'status',
        'amount_fils',
        'reason',
        'merchant_order_id',
        'return_request_id',
      ])
      .where('provider_ref', '=', event.refundId)
      .forUpdate()
      .executeTakeFirst();
    if (!refund) return { result: 'unknown_refund' };
    if (refund.status !== 'pending') return { result: 'already_settled' };
    const payment = await trx
      .selectFrom('payments')
      .select(['id', 'booking_id'])
      .where('id', '=', refund.payment_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const ok = event.type === 'refund.succeeded';
    await trx
      .updateTable('refunds')
      .set({
        status: ok ? 'succeeded' : 'failed',
        failure_code: ok ? null : (event.failureCode ?? 'failed'),
      })
      .where('id', '=', refund.id)
      .execute();
    if (ok) {
      // The ledger moves only when the provider confirms (docs/05-workflows.md).
      if (refund.reason === 'late_payment') {
        await post(
          trx,
          {
            kind: 'late_refund',
            sourceType: 'refund',
            sourceId: refund.id,
            businessId: null,
            occurredAt: now,
          },
          postings.lateRefund(refund.amount_fils),
        );
      } else {
        const earning = await earningForRefund(trx, {
          bookingId: payment.booking_id,
          merchantOrderId: refund.merchant_order_id,
        });
        if (earning) {
          await reverseEarning(
            trx,
            earning,
            refund.amount_fils,
            { kind: 'refund', type: 'refund', id: refund.id },
            now,
          );
        } else {
          // A refund we cannot attribute to a seller must not vanish from the books.
          await trx
            .updateTable('payments')
            .set({ needs_attention: true })
            .where('id', '=', payment.id)
            .execute();
        }
      }
    } else {
      await trx
        .updateTable('payments')
        .set({ needs_attention: true })
        .where('id', '=', payment.id)
        .execute();
    }
    if (refund.return_request_id) {
      await this.settleReturn(trx, refund.return_request_id, ok, now);
    }
    const status = await this.refreshStatus(trx, payment.id);
    return { result: ok ? status : 'refund_failed' };
  }

  /** A return's refund was confirmed or refused by the provider (ADR-0016). */
  private async settleReturn(trx: Trx, returnRequestId: string, ok: boolean, now: Date) {
    const rr = await trx
      .updateTable('return_requests')
      .set({ status: ok ? 'refunded' : 'refund_failed' })
      .where('id', '=', returnRequestId)
      .where('status', '=', 'refund_pending')
      .returning(['id', 'order_id', 'merchant_order_id'])
      .executeTakeFirst();
    if (!rr) return;
    await this.outbox(
      trx,
      ok ? 'return.refunded' : 'payment.manual_exception',
      { returnId: rr.id, orderId: rr.order_id, merchantOrderId: rr.merchant_order_id },
      now,
    );
  }

  /** Recomputes a settled payment's status from its refunds. The payment row must be locked. */
  private async refreshStatus(trx: Trx, paymentId: string) {
    const payment = await trx
      .selectFrom('payments')
      .select(['amount_fils'])
      .where('id', '=', paymentId)
      .executeTakeFirstOrThrow();
    const rows = await trx
      .selectFrom('refunds')
      .select(['status', 'amount_fils'])
      .where('payment_id', '=', paymentId)
      .execute();
    const status = paymentStatusAfterRefunds({
      capturedFils: payment.amount_fils,
      succeededFils: rows
        .filter((r) => r.status === 'succeeded')
        .reduce((total, r) => total + r.amount_fils, 0),
      pendingCount: rows.filter((r) => r.status === 'pending').length,
      failedWithoutSuccess:
        rows.some((r) => r.status === 'failed') && !rows.some((r) => r.status === 'succeeded'),
    });
    await trx.updateTable('payments').set({ status }).where('id', '=', paymentId).execute();
    return status;
  }

  /**
   * Records a refund of a settled payment inside the caller's transaction (the payment row must
   * already be locked). Returns the job to pass to `issueRefund` after the transaction commits.
   */
  async requestRefund(
    trx: Trx,
    input: {
      paymentId: string;
      amountFils: number;
      reason: RefundReason;
      target: RefundJob['target'];
      merchantOrderId?: string | null;
      refundRequestId?: string | null;
      returnRequestId?: string | null;
    },
    now: Date,
  ): Promise<RefundJob | null> {
    if (input.amountFils <= 0) return null;
    const payment = await trx
      .selectFrom('payments')
      .select(['id', 'status', 'provider_intent_id'])
      .where('id', '=', input.paymentId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const refundable = ['succeeded', 'refund_pending', 'partially_refunded', 'refund_failed'];
    if (!refundable.includes(payment.status) || !payment.provider_intent_id) return null;
    let refund: { id: string };
    try {
      refund = await trx
        .insertInto('refunds')
        .values({
          payment_id: payment.id,
          amount_fils: input.amountFils,
          reason: input.reason,
          merchant_order_id: input.merchantOrderId ?? null,
          refund_request_id: input.refundRequestId ?? null,
          return_request_id: input.returnRequestId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    } catch (error) {
      if ((error as { constraint?: string }).constraint === 'refunds_within_capture') {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'REFUND_EXCEEDS_CAPTURE',
          'Refunds cannot add up to more than was paid.',
        );
      }
      throw error;
    }
    await trx
      .updateTable('payments')
      .set({ status: 'refund_pending' })
      .where('id', '=', payment.id)
      .execute();
    await this.outbox(
      trx,
      'payment.refund_requested',
      {
        paymentId: payment.id,
        refundId: refund.id,
        reason: input.reason,
        [`${input.target.type}Id`]: input.target.id,
      },
      now,
    );
    return {
      paymentId: payment.id,
      refundId: refund.id,
      intentId: payment.provider_intent_id,
      amountFils: input.amountFils,
      target: input.target,
    };
  }

  private async applyBooking(
    trx: Trx,
    payment: {
      id: string;
      booking_id: string;
      amount_fils: number;
      currency: string;
      status: string;
    },
    event: ProviderEvent,
    now: Date,
  ): Promise<{ result: string; lateRefund?: LateRefund }> {
    const booking = await trx
      .selectFrom('bookings')
      .select(['id', 'status', 'hold_expires_at', 'user_id', 'business_id', 'price_fils'])
      .where('id', '=', payment.booking_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await trx
      .selectFrom('payments')
      .select('id')
      .where('id', '=', payment.id)
      .forUpdate()
      .execute();
    if (event.amountFils !== payment.amount_fils || event.currency !== payment.currency) {
      await trx
        .updateTable('payments')
        .set({ needs_attention: true })
        .where('id', '=', payment.id)
        .execute();
      return { result: 'amount_mismatch' };
    }
    const holdValid =
      booking.status === 'held' && !!booking.hold_expires_at && booking.hold_expires_at > now;

    if (event.type === 'payment_intent.payment_failed') {
      if (payment.status !== 'requires_payment') return { result: 'already_settled' };
      await trx
        .updateTable('payments')
        .set({ status: 'failed', failure_code: event.failureCode ?? 'failed' })
        .where('id', '=', payment.id)
        .execute();
      if (booking.status === 'held') {
        // The time goes back on sale; the customer can pick it again if it is still free.
        await trx
          .updateTable('bookings')
          .set({ status: 'expired', expired_at: now, version: (eb) => eb('version', '+', 1) })
          .where('id', '=', booking.id)
          .execute();
        await this.outbox(trx, 'booking.payment_failed', { bookingId: booking.id }, now);
      }
      return { result: 'payment_failed' };
    }

    if (payment.status !== 'requires_payment' && payment.status !== 'failed') {
      return { result: 'already_settled' };
    }
    await trx
      .updateTable('payments')
      .set({ status: 'succeeded', succeeded_at: now, failure_code: null })
      .where('id', '=', payment.id)
      .execute();
    if (!holdValid) {
      // Late payment: the hold ended, so the time may belong to someone else. Refund in full.
      if (booking.status === 'held') {
        await trx
          .updateTable('bookings')
          .set({ status: 'expired', expired_at: now, version: (eb) => eb('version', '+', 1) })
          .where('id', '=', booking.id)
          .execute();
      }
      await post(
        trx,
        {
          kind: 'late_capture',
          sourceType: 'payment',
          sourceId: payment.id,
          businessId: null,
          occurredAt: now,
        },
        postings.lateCapture(payment.amount_fils),
      );
      const job = await this.requestRefund(
        trx,
        {
          paymentId: payment.id,
          amountFils: payment.amount_fils,
          reason: 'late_payment',
          target: { type: 'booking', id: booking.id },
        },
        now,
      );
      return job
        ? { result: 'late_payment_refund_requested', lateRefund: job }
        : { result: 'late_payment' };
    }
    await trx
      .updateTable('bookings')
      .set({ status: 'confirmed', confirmed_at: now, version: (eb) => eb('version', '+', 1) })
      .where('id', '=', booking.id)
      .execute();
    await recordBookingCapture(
      trx,
      { id: booking.id, businessId: booking.business_id, priceFils: booking.price_fils },
      payment.id,
      now,
    );
    await this.outbox(
      trx,
      'booking.confirmed',
      { bookingId: booking.id, userId: booking.user_id, businessId: booking.business_id },
      now,
    );
    return { result: 'confirmed' };
  }

  /** Calls the provider outside the database transaction; failures are flagged, never hidden. */
  async issueRefund(r: RefundJob) {
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
      this.log.error({ err: error, target: r.target }, 'automatic refund failed');
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('refunds')
          .set({ status: 'failed', failure_code: 'provider_refused' })
          .where('id', '=', r.refundId)
          .where('status', '=', 'pending')
          .execute();
        await trx
          .updateTable('return_requests')
          .set({ status: 'refund_failed' })
          .where('refund_id', '=', r.refundId)
          .where('status', '=', 'refund_pending')
          .execute();
        await trx
          .selectFrom('payments')
          .select('id')
          .where('id', '=', r.paymentId)
          .forUpdate()
          .execute();
        await trx
          .updateTable('payments')
          .set({ needs_attention: true })
          .where('id', '=', r.paymentId)
          .execute();
        await this.refreshStatus(trx, r.paymentId);
        await this.outbox(
          trx,
          'payment.manual_exception',
          { [`${r.target.type}Id`]: r.target.id, paymentId: r.paymentId },
          this.clock.now(),
        );
        await writeAudit(trx, {
          actorType: 'system',
          actorId: null,
          action: 'payment.refund_failed',
          targetType: 'payment',
          targetId: r.paymentId,
          diff: { [`${r.target.type}Id`]: r.target.id, amountFils: r.amountFils },
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
