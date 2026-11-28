import { reconciliationRunSchema, type AdminSession } from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvedVenue, confirmedBooking, dubaiDay, held, type Venue } from '../testing/booking.js';
import {
  adminLogin,
  bearer,
  type Harness,
  provisionAdmin,
  signUp,
  startHarness,
  uniqueEmail,
} from '../testing/harness.js';

const DAY_MS = 86_400_000;

let h: Harness;
let finance: { email: string; secret: string; id: string };
let support: { email: string; secret: string; id: string };
let session: { session: AdminSession; at: number } | null = null;
let day: string;

/**
 * Reconciliation is one run per provider and UTC day, and the database is shared with the other
 * integration test files (each with its own in-memory mock provider). So this file moves its
 * clock to 01:00 UTC on a random far-future day and keeps all its money movements on that day.
 */
beforeAll(async () => {
  h = await startHarness();
  const now = h.clock.now().getTime();
  const target =
    Math.floor(now / DAY_MS) * DAY_MS + (3_000 + Math.floor(Math.random() * 20_000)) * DAY_MS;
  h.clock.advance((target + 3_600_000 - now) / 1000);
  day = new Date(target).toISOString().slice(0, 10);
  finance = await provisionAdmin(h, ['finance']);
  support = await provisionAdmin(h, ['support']);
});
afterAll(async () => {
  await h.close();
});

async function as(who: 'finance' | 'support') {
  if (who === 'support') return bearer(await adminLogin(h, support));
  if (!session || h.clock.now().getTime() - session.at > 10 * 60_000) {
    session = { session: await adminLogin(h, finance), at: h.clock.now().getTime() };
  }
  return bearer(session.session);
}

async function booked(v: Venue, time: string) {
  const user = await signUp(h, uniqueEmail('recon-booker'));
  const booking = await confirmedBooking(h, user, {
    branchId: v.branchId,
    serviceId: v.serviceId,
    startAt: dubaiDay(h, 2).at(time),
  });
  return { user, booking };
}

async function paymentOf(bookingId: string) {
  return h.db
    .selectFrom('payments')
    .select(['id', 'provider_intent_id', 'status', 'amount_fils', 'reconciled_at'])
    .where('booking_id', '=', bookingId)
    .executeTakeFirstOrThrow();
}

function reconcile(date?: string) {
  return h
    .http()
    .post('/v1/admin/finance/reconciliation-runs')
    .set('Authorization', bearer(session?.session as AdminSession))
    .send(date ? { date } : {});
}

describe('daily reconciliation (T15)', () => {
  it('recovers lost webhooks, flags disagreements and runs once per day', async () => {
    const v = await approvedVenue(h);
    await as('finance');

    // A payment whose success webhook never arrives.
    const lostUser = await signUp(h, uniqueEmail('recon-lost'));
    const lost = await held(h, lostUser, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 2).at('10:00'),
    });
    // Keep the hold open until the end of the test, so recovery confirms the booking.
    await h.db
      .updateTable('bookings')
      .set({ hold_expires_at: new Date(h.clock.now().getTime() + 3 * DAY_MS) })
      .where('id', '=', lost.id)
      .execute();
    const pay = await h
      .http()
      .post(`/v1/bookings/${lost.id}/pay`)
      .set('Authorization', bearer(lostUser))
      .expect(200);
    h.psp.dropWebhooks = true;
    await h
      .http()
      .post(`/v1/mock-psp/intents/${pay.body.paymentIntentId}/confirm`)
      .send({ clientSecret: pay.body.paymentClientSecret, outcome: 'success' })
      .expect(200);
    h.psp.dropWebhooks = false;
    expect((await paymentOf(lost.id)).status).toBe('requires_payment');

    // A refund whose webhook never arrives.
    const { booking: refunded } = await booked(v, '12:00');
    const refundedPayment = await paymentOf(refunded.id);
    h.psp.dropWebhooks = true;
    await h
      .http()
      .post('/v1/admin/finance/refund-requests')
      .set('Authorization', await as('support'))
      .send({ paymentId: refundedPayment.id, amountFils: 2_500, reason: 'Late start' })
      .expect(201);
    h.psp.dropWebhooks = false;
    const pendingRefund = await h.db
      .selectFrom('refunds')
      .select(['id', 'status'])
      .where('payment_id', '=', refundedPayment.id)
      .executeTakeFirstOrThrow();
    expect(pendingRefund.status).toBe('pending');

    // A payment the provider's books record with a different amount.
    const { booking: tampered } = await booked(v, '14:00');
    const tamperedPayment = await paymentOf(tampered.id);
    h.psp.tamperAmount(tamperedPayment.provider_intent_id as string, 1);

    // A clean payment.
    const { booking: clean } = await booked(v, '16:00');

    // The day is not over yet.
    const early = await reconcile(day).expect(422);
    expect(early.body.error.code).toBe('PERIOD_NOT_OVER');

    h.clock.advance(DAY_MS / 1000);
    await as('finance');
    const run = reconciliationRunSchema.parse((await reconcile().expect(201)).body);
    expect(run.failure).toBeNull();
    expect(run).toMatchObject({
      periodStart: `${day}T00:00:00.000Z`,
      status: 'completed',
      recoveredCount: 2,
      mismatchCount: 1,
    });
    expect(run.checkedCount).toBeGreaterThanOrEqual(5);
    const byKind = (kind: string) => run.items.filter((i) => i.kind === kind);
    expect(
      byKind('recovered_missing_webhook')
        .map((i) => i.objectType)
        .sort(),
    ).toEqual(['payment', 'refund']);
    expect(byKind('recovered_missing_webhook').every((i) => i.resolvedAt !== null)).toBe(true);
    const [mismatch] = byKind('amount_mismatch');
    expect(mismatch).toMatchObject({
      objectType: 'payment',
      paymentId: tamperedPayment.id,
      localAmountFils: tamperedPayment.amount_fils,
      providerAmountFils: 1,
      resolvedAt: null,
    });

    // Recovery went through the normal webhook path: the booking is confirmed, the refund
    // settled, and the ledger recorded both.
    const lostBooking = await h.db
      .selectFrom('bookings')
      .select('status')
      .where('id', '=', lost.id)
      .executeTakeFirstOrThrow();
    expect(lostBooking.status).toBe('confirmed');
    expect((await paymentOf(lost.id)).status).toBe('succeeded');
    expect((await paymentOf(refunded.id)).status).toBe('partially_refunded');
    const refundTx = await h.db
      .selectFrom('ledger_transactions')
      .select('kind')
      .where('source_id', '=', pendingRefund.id)
      .execute();
    expect(refundTx).toHaveLength(1);
    const lostEarning = await h.db
      .selectFrom('merchant_earnings')
      .select('id')
      .where('booking_id', '=', lost.id)
      .execute();
    expect(lostEarning).toHaveLength(1);

    // Agreeing payments are marked reconciled; the disagreeing one is not changed.
    expect((await paymentOf(clean.id)).reconciled_at).not.toBeNull();
    expect(await paymentOf(tampered.id)).toMatchObject({
      status: 'succeeded',
      amount_fils: tamperedPayment.amount_fils,
      reconciled_at: null,
    });

    // One run per day.
    const again = await reconcile(day).expect(409);
    expect(again.body.error.code).toBe('ALREADY_RECONCILED');

    // Finance marks the finding handled; support cannot.
    await h
      .http()
      .post(`/v1/admin/finance/reconciliation-items/${mismatch?.id}/resolve`)
      .set('Authorization', await as('support'))
      .send({ note: 'Checked with the provider' })
      .expect(403);
    const resolved = reconciliationRunSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/finance/reconciliation-items/${mismatch?.id}/resolve`)
          .set('Authorization', await as('finance'))
          .send({ note: 'Provider statement corrected; our amount stands' })
          .expect(200)
      ).body,
    );
    expect(resolved.items.find((i) => i.id === mismatch?.id)).toMatchObject({
      resolvedBy: { id: finance.id },
      resolutionNote: 'Provider statement corrected; our amount stands',
    });
    await h
      .http()
      .post(`/v1/admin/finance/reconciliation-items/${mismatch?.id}/resolve`)
      .set('Authorization', await as('finance'))
      .send({ note: 'Again' })
      .expect(404);

    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', run.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('finance.reconciliation_started');
  });
});
