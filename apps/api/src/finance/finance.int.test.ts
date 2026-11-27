import {
  adminPaymentSchema,
  disputeSchema,
  financeOverviewSchema,
  financeSummarySchema,
  pageSchema,
  payoutRunResultSchema,
  refundRequestSchema,
  earningSchema,
  type AdminSession,
} from '@jays/contracts';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvedVenue, confirmedBooking, dubaiDay, type Venue } from '../testing/booking.js';
import {
  addToCart,
  approvedShop,
  customerWithAddress,
  listedProduct,
  pay,
  placedOrder,
  quoteFor,
} from '../testing/commerce.js';
import {
  adminLogin,
  bearer,
  type Harness,
  provisionAdmin,
  signUp,
  startHarness,
  uniqueEmail,
} from '../testing/harness.js';

let h: Harness;
const admins: Record<string, { email: string; secret: string; id: string }> = {};
const sessions: Record<string, { session: AdminSession; at: number }> = {};

beforeAll(async () => {
  h = await startHarness();
  for (const [name, roles] of Object.entries({
    finance: ['finance'],
    finance2: ['finance'],
    support: ['support'],
    catalog: ['catalog'],
  })) {
    admins[name] = await provisionAdmin(h, roles);
  }
});
afterAll(async () => {
  await h.close();
});

/** A signed-in admin; re-signs after 10 minutes of test-clock time. */
async function admin(name: string) {
  const cached = sessions[name];
  if (cached && h.clock.now().getTime() - cached.at < 10 * 60_000) return cached.session;
  const session = await adminLogin(h, admins[name] as { email: string; secret: string });
  sessions[name] = { session, at: h.clock.now().getTime() };
  return session;
}
const as = async (name: string) => bearer(await admin(name));

/** A business-specific commission rule, so these tests do not depend on platform rules. */
async function commission(businessId: string, mode: 'shop' | 'services', bps: number) {
  await h
    .http()
    .post('/v1/admin/finance/fee-rules')
    .set('Authorization', await as('finance'))
    .send({ mode, businessId, commissionBps: bps, reason: 'Fictional test rate' })
    .expect(201);
}

async function ledgerFor(businessId: string) {
  const rows = await h.db
    .selectFrom('ledger_entries')
    .select(['account', sql<string>`sum(credit_fils - debit_fils)`.as('balance')])
    .where('business_id', '=', businessId)
    .groupBy('account')
    .execute();
  const get = (a: string) => Number(rows.find((r) => r.account === a)?.balance ?? 0);
  return { payable: get('merchant_payable'), inTransit: get('payouts_in_transit') };
}

async function unbalancedTransactions() {
  const { rows } = await sql<{ n: string }>`
    SELECT count(*) AS n FROM (
      SELECT transaction_id FROM ledger_entries GROUP BY transaction_id
      HAVING sum(debit_fils) <> sum(credit_fils)) t`.execute(h.db);
  return Number(rows[0]?.n ?? 0);
}

async function earningOf(bookingId: string) {
  return h.db
    .selectFrom('merchant_earnings')
    .selectAll()
    .where('booking_id', '=', bookingId)
    .executeTakeFirstOrThrow();
}

async function paymentIdOf(bookingId: string) {
  return (
    await h.db
      .selectFrom('payments')
      .select('id')
      .where('booking_id', '=', bookingId)
      .executeTakeFirstOrThrow()
  ).id;
}

/** Marks a booking done long enough ago that it is past the dispute window. */
async function completedLongAgo(bookingId: string, days = 8) {
  const at = new Date(h.clock.now().getTime() - days * 86_400_000);
  await h.db
    .updateTable('bookings')
    .set({ status: 'completed', checked_in_at: at, completed_at: at })
    .where('id', '=', bookingId)
    .execute();
}

async function booked(v: Venue, day: number, time: string) {
  const user = await signUp(h, uniqueEmail('fin-booker'));
  const booking = await confirmedBooking(h, user, {
    branchId: v.branchId,
    serviceId: v.serviceId,
    startAt: dubaiDay(h, day).at(time),
  });
  return { user, booking };
}

async function runPayouts() {
  const res = await h
    .http()
    .post('/v1/admin/finance/payout-runs')
    .set('Authorization', await as('finance'))
    .expect(200);
  return payoutRunResultSchema.parse(res.body);
}

describe('capture and the ledger (T06)', () => {
  it('records the earning and a balanced capture once, even for a duplicated webhook', async () => {
    const v = await approvedVenue(h);
    await commission(v.businessId, 'services', 1_000);
    const user = await signUp(h, uniqueEmail('fin-booker'));
    const hold = await h
      .http()
      .post('/v1/bookings/hold')
      .set('Authorization', bearer(user))
      .set('Idempotency-Key', `hold-${Date.now()}`)
      .send({ branchId: v.branchId, serviceId: v.serviceId, startAt: dubaiDay(h, 2).at('10:00') })
      .expect(201);
    const pay = await h
      .http()
      .post(`/v1/bookings/${hold.body.id}/pay`)
      .set('Authorization', bearer(user))
      .expect(200);
    await h
      .http()
      .post(`/v1/mock-psp/intents/${pay.body.paymentIntentId}/confirm`)
      .send({ clientSecret: pay.body.paymentClientSecret, outcome: 'duplicate' })
      .expect(200);
    const results = await h.deliverWebhooks();
    expect(results).toHaveLength(2);

    const e = await earningOf(hold.body.id);
    expect(e).toMatchObject({
      gross_fils: 10_500,
      commission_bps: 1_000,
      commission_fils: 1_050,
      status: 'pending',
    });
    const txs = await h.db
      .selectFrom('ledger_transactions')
      .select(['kind'])
      .where('source_id', '=', e.id)
      .execute();
    expect(txs).toEqual([{ kind: 'capture' }]);
    expect(await ledgerFor(v.businessId)).toEqual({ payable: 9_450, inTransit: 0 });
    expect(await unbalancedTransactions()).toBe(0);
  });

  it('splits a multi-seller order into earnings with commission on goods only', async () => {
    const shopA = await approvedShop(h, [{ emirate: 'DXB', feeFils: 1_500 }]);
    const shopB = await approvedShop(h, [{ emirate: 'DXB', feeFils: 2_000 }]);
    await commission(shopA.businessId, 'shop', 1_000);
    await commission(shopB.businessId, 'shop', 500);
    const a = await listedProduct(h, shopA, [{ priceFils: 10_000, stock: 5 }]);
    const b = await listedProduct(h, shopB, [{ priceFils: 4_000, stock: 5 }]);
    const { customer, addressId } = await customerWithAddress(h);
    await addToCart(h, customer, a.variantIds[0] as string, 2);
    await addToCart(h, customer, b.variantIds[0] as string, 1);
    const quote = await quoteFor(h, customer, addressId);
    const order = await placedOrder(h, customer, quote.quoteId);
    await pay(h, order);
    const earnings = await h.db
      .selectFrom('merchant_earnings as e')
      .innerJoin('merchant_orders as mo', 'mo.id', 'e.merchant_order_id')
      .select(['e.business_id', 'e.gross_fils', 'e.commission_fils', 'mo.total_fils'])
      .where('mo.order_id', '=', order.orderId)
      .execute();
    const byBiz = Object.fromEntries(earnings.map((e) => [e.business_id, e]));
    expect(byBiz[shopA.businessId]).toMatchObject({ gross_fils: 21_500, commission_fils: 2_000 });
    expect(byBiz[shopB.businessId]).toMatchObject({ gross_fils: 6_000, commission_fils: 200 });
    expect(await ledgerFor(shopA.businessId)).toEqual({ payable: 19_500, inTransit: 0 });
    expect(await unbalancedTransactions()).toBe(0);
  });

  it('keeps the commission rate captured even after the rule changes (T13)', async () => {
    const v = await approvedVenue(h);
    await commission(v.businessId, 'services', 1_000);
    const { booking } = await booked(v, 2, '11:00');
    h.clock.advance(1);
    await commission(v.businessId, 'services', 2_000);
    expect((await earningOf(booking.id)).commission_bps).toBe(1_000);
    const { booking: later } = await booked(v, 2, '13:00');
    expect((await earningOf(later.id)).commission_bps).toBe(2_000);
  });
});

describe('refunds (T09, T16)', () => {
  it('returns commission in proportion when a customer cancels late', async () => {
    const v = await approvedVenue(h);
    await commission(v.businessId, 'services', 1_000);
    const { user, booking } = await booked(v, 3, '10:00');
    await h.db
      .updateTable('bookings')
      .set({
        start_at: new Date(h.clock.now().getTime() + 3_600_000),
        end_at: new Date(h.clock.now().getTime() + 7_200_000),
        occupied_start: new Date(h.clock.now().getTime() + 3_600_000),
        occupied_end: new Date(h.clock.now().getTime() + 8_100_000),
      })
      .where('id', '=', booking.id)
      .execute();
    await h
      .http()
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', bearer(user))
      .send({})
      .expect(200);
    await h.deliverWebhooks();
    const e = await earningOf(booking.id);
    expect(e).toMatchObject({ refunded_fils: 5_250, commission_refunded_fils: 525 });
    // 10,500 - 1,050 commission - (5,250 - 525) returned = 4,725 still owed to the venue.
    expect(await ledgerFor(v.businessId)).toEqual({ payable: 4_725, inTransit: 0 });
    expect(await unbalancedTransactions()).toBe(0);
  });

  it('issues a refund at or below the threshold at once and refuses more than was paid', async () => {
    const v = await approvedVenue(h);
    const { booking } = await booked(v, 3, '12:00');
    const paymentId = await paymentIdOf(booking.id);
    const res = await h
      .http()
      .post('/v1/admin/finance/refund-requests')
      .set('Authorization', await as('support'))
      .send({ paymentId, amountFils: 3_000, reason: 'Service ran short' })
      .expect(201);
    const request = refundRequestSchema.parse(res.body);
    expect(request).toMatchObject({ status: 'approved', needsSecondApproval: false });
    expect(request.refund?.status).toBe('pending');
    await h.deliverWebhooks();

    const view = adminPaymentSchema.parse(
      (
        await h
          .http()
          .get(`/v1/admin/finance/payments/${paymentId}`)
          .set('Authorization', await as('support'))
          .expect(200)
      ).body,
    );
    expect(view).toMatchObject({ status: 'partially_refunded', refundedFils: 3_000 });
    expect(view.sellers[0]?.refundableFils).toBe(7_500);

    const tooMuch = await h
      .http()
      .post('/v1/admin/finance/refund-requests')
      .set('Authorization', await as('support'))
      .send({ paymentId, amountFils: 7_501, reason: 'Too much' })
      .expect(422);
    expect(tooMuch.body.error.code).toBe('REFUND_EXCEEDS_CAPTURE');

    // The database refuses it too, whatever the code does.
    await expect(
      h.db
        .insertInto('refunds')
        .values({ payment_id: paymentId, amount_fils: 7_501, reason: 'customer_cancellation' })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('needs a second, different admin above the threshold (T16)', async () => {
    const v = await approvedVenue(h, { service: { priceFils: 80_000 } });
    const { booking } = await booked(v, 4, '10:00');
    const paymentId = await paymentIdOf(booking.id);
    const created = refundRequestSchema.parse(
      (
        await h
          .http()
          .post('/v1/admin/finance/refund-requests')
          .set('Authorization', await as('finance'))
          .send({ paymentId, amountFils: 60_000, reason: 'Goodwill after complaint' })
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({
      status: 'pending_approval',
      needsSecondApproval: true,
      refund: null,
    });
    expect(h.webhooks).toHaveLength(0);

    const self = await h
      .http()
      .post(`/v1/admin/finance/refund-requests/${created.id}/decision`)
      .set('Authorization', await as('finance'))
      .send({ decision: 'approve' })
      .expect(403);
    expect(self.body.error.code).toBe('SAME_APPROVER');

    const approved = refundRequestSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/finance/refund-requests/${created.id}/decision`)
          .set('Authorization', await as('finance2'))
          .send({ decision: 'approve', note: 'Checked the complaint' })
          .expect(200)
      ).body,
    );
    expect(approved.status).toBe('approved');
    expect(approved.decidedBy?.id).toBe(admins['finance2']?.id);
    await h.deliverWebhooks();
    const payment = await h.db
      .selectFrom('payments')
      .select('status')
      .where('id', '=', paymentId)
      .executeTakeFirstOrThrow();
    expect(payment.status).toBe('partially_refunded');

    const again = await h
      .http()
      .post(`/v1/admin/finance/refund-requests/${created.id}/decision`)
      .set('Authorization', await as('finance2'))
      .send({ decision: 'approve' })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');

    // The database refuses a self-approval even if the code were wrong.
    await expect(
      h.db
        .updateTable('refund_requests')
        .set({ decided_by: admins['finance']?.id })
        .where('id', '=', created.id)
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('payouts', () => {
  it('pays eligible earnings once, and settles the ledger on the provider webhook', async () => {
    const v = await approvedVenue(h);
    await commission(v.businessId, 'services', 1_000);
    const done = await booked(v, 5, '10:00');
    const upcoming = await booked(v, 5, '12:00');
    await completedLongAgo(done.booking.id);

    const run = await runPayouts();
    const mine = run.payouts.filter((p) => p.business.id === v.businessId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ amountFils: 9_450, status: 'pending', earningCount: 1 });
    expect(await ledgerFor(v.businessId)).toEqual({ payable: 9_450, inTransit: 9_450 });

    // A second run finds nothing new for this business.
    const second = await runPayouts();
    expect(second.payouts.filter((p) => p.business.id === v.businessId)).toHaveLength(0);

    await h.deliverWebhooks();
    expect((await earningOf(done.booking.id)).status).toBe('paid_out');
    expect((await earningOf(upcoming.booking.id)).status).toBe('pending');
    expect(await ledgerFor(v.businessId)).toEqual({ payable: 9_450, inTransit: 0 });

    const summary = financeSummarySchema.parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${v.businessId}/finance/summary`)
          .set('Authorization', bearer(v.owner))
          .expect(200)
      ).body,
    );
    expect(summary).toMatchObject({
      paidOutFils: 9_450,
      pendingFils: 9_450,
      eligibleFils: 0,
      payableBalanceFils: 9_450,
      inTransitFils: 0,
      commissionFils: 2_100,
    });
    expect(await unbalancedTransactions()).toBe(0);
  });

  it('holds back disputed earnings, recovers a lost dispute from the next payout (T09)', async () => {
    const v = await approvedVenue(h);
    const first = await booked(v, 6, '10:00');
    const second = await booked(v, 6, '12:00');
    await completedLongAgo(first.booking.id);
    const e = await earningOf(first.booking.id);
    const dispute = disputeSchema.parse(
      (
        await h
          .http()
          .post('/v1/admin/finance/disputes')
          .set('Authorization', await as('finance'))
          .send({ earningId: e.id, amountFils: 10_500, reason: 'Card holder disputes charge' })
          .expect(201)
      ).body,
    );
    const blocked = await runPayouts();
    expect(blocked.payouts.filter((p) => p.business.id === v.businessId)).toHaveLength(0);

    await h
      .http()
      .post(`/v1/admin/finance/disputes/${dispute.id}/resolution`)
      .set('Authorization', await as('finance'))
      .send({ outcome: 'lost', note: 'Provider ruled for the card holder' })
      .expect(200);
    expect(await ledgerFor(v.businessId)).toEqual({ payable: 10_500, inTransit: 0 });

    // The lost booking is worth nothing now; the second one pays out in full.
    await completedLongAgo(second.booking.id);
    const run = await runPayouts();
    expect(run.payouts.find((p) => p.business.id === v.businessId)?.amountFils).toBe(10_500);
    await h.deliverWebhooks();
    expect(await ledgerFor(v.businessId)).toEqual({ payable: 0, inTransit: 0 });
  });

  it('skips businesses on hold, and returns a failed payout to the balance', async () => {
    const v = await approvedVenue(h);
    const { booking } = await booked(v, 7, '10:00');
    await completedLongAgo(booking.id);
    const holds = await h
      .http()
      .post('/v1/admin/finance/holds')
      .set('Authorization', await as('finance'))
      .send({ businessId: v.businessId, reason: 'Licence renewal pending' })
      .expect(201);
    const hold = (holds.body as { id: string; business: { id: string } }[]).find(
      (x) => x.business.id === v.businessId,
    );
    const held = await runPayouts();
    expect(held.skipped).toContainEqual(
      expect.objectContaining({
        business: expect.objectContaining({ id: v.businessId }),
        reason: 'on_hold',
      }),
    );
    await h
      .http()
      .post(`/v1/admin/finance/holds/${hold?.id}/release`)
      .set('Authorization', await as('finance'))
      .expect(200);

    h.psp.failPayouts = true;
    try {
      await runPayouts();
      await h.deliverWebhooks();
    } finally {
      h.psp.failPayouts = false;
    }
    const payout = await h.db
      .selectFrom('payouts')
      .select(['status', 'needs_attention'])
      .where('business_id', '=', v.businessId)
      .executeTakeFirstOrThrow();
    expect(payout).toEqual({ status: 'failed', needs_attention: true });
    expect((await earningOf(booking.id)).status).toBe('eligible');
    expect(await ledgerFor(v.businessId)).toEqual({ payable: 10_500, inTransit: 0 });
    expect(await unbalancedTransactions()).toBe(0);
  });
});

describe('access', () => {
  it('lets owners and finance members read finance, nobody else', async () => {
    const v = await approvedVenue(h);
    await h
      .http()
      .get(`/v1/businesses/${v.businessId}/finance/earnings`)
      .set('Authorization', bearer(v.owner))
      .expect(200)
      .then((r) => pageSchema(earningSchema).parse(r.body));
    const outsider = await signUp(h, uniqueEmail('outsider'));
    await h
      .http()
      .get(`/v1/businesses/${v.businessId}/finance/summary`)
      .set('Authorization', bearer(outsider))
      .expect(404);
    // Catalog admins see no finance; support cannot run payouts or change rules.
    await h
      .http()
      .get('/v1/admin/finance/overview')
      .set('Authorization', await as('catalog'))
      .expect(403);
    await h
      .http()
      .post('/v1/admin/finance/payout-runs')
      .set('Authorization', await as('support'))
      .expect(403);
    await h
      .http()
      .post('/v1/admin/finance/fee-rules')
      .set('Authorization', await as('support'))
      .send({ mode: 'shop', commissionBps: 1, reason: 'Nope' })
      .expect(403);
  });

  it('versions rules and settings without rewriting history', async () => {
    const past = await h
      .http()
      .post('/v1/admin/finance/fee-rules')
      .set('Authorization', await as('finance'))
      .send({
        mode: 'shop',
        commissionBps: 900,
        effectiveAt: new Date(h.clock.now().getTime() - 86_400_000).toISOString(),
        reason: 'Backdated',
      })
      .expect(422);
    expect(past.body.error.code).toBe('EFFECTIVE_IN_PAST');
    const future = new Date(
      h.clock.now().getTime() + (400 + Math.floor(Math.random() * 10_000)) * 86_400_000,
    );
    await h
      .http()
      .post('/v1/admin/finance/settings')
      .set('Authorization', await as('finance'))
      .send({
        key: 'payout_dispute_window_days',
        value: 14,
        effectiveAt: future.toISOString(),
        reason: 'Planned change',
      })
      .expect(201);
    const overview = financeOverviewSchema.parse(
      (
        await h
          .http()
          .get('/v1/admin/finance/overview')
          .set('Authorization', await as('finance'))
          .expect(200)
      ).body,
    );
    // Not in force yet: today's value is unchanged.
    expect(overview.settings.find((s) => s.key === 'payout_dispute_window_days')?.value).not.toBe(
      14,
    );
    await expect(
      sql`UPDATE fee_rules SET commission_bps = 1 WHERE true`.execute(h.db),
    ).rejects.toMatchObject({ code: '42501' });
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('action', '=', 'finance.setting_changed')
      .where('actor_id', '=', admins['finance']?.id as string)
      .execute();
    expect(audit.length).toBeGreaterThan(0);
  });
});
