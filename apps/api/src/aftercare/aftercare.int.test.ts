import {
  adminDashboardSchema,
  adminOrderSchema,
  adminReviewSchema,
  adminTicketSchema,
  businessDashboardSchema,
  merchantOrderSchema,
  merchantReviewSchema,
  myReviewSchema,
  notificationPageSchema,
  notificationTemplateSchema,
  orderSchema,
  outboxHealthSchema,
  pageSchema,
  returnSchema,
  reviewSummarySchema,
  ticketSchema,
  type AdminSession,
} from '@jays/contracts';
import { NOTIFICATION_MAX_ATTEMPTS } from '@jays/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { approvedVenue, confirmedBooking, dubaiDay } from '../testing/booking.js';
import {
  addToCart,
  approvedShop,
  customerWithAddress,
  listedProduct,
  pay,
  placedOrder,
  quoteFor,
  stockOf,
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
import { NotificationsService } from './notifications.service.js';

let h: Harness;
const admins: Record<string, { email: string; secret: string; id: string }> = {};
const sessions: Record<string, AdminSession> = {};

beforeAll(async () => {
  h = await startHarness();
  for (const [name, roles] of Object.entries({
    support: ['support'],
    operations: ['operations'],
    finance: ['finance'],
    catalog: ['catalog'],
    analyst: ['analyst'],
  })) {
    admins[name] = await provisionAdmin(h, roles);
  }
});
afterAll(async () => {
  await h.close();
});

async function as(name: string) {
  sessions[name] ??= await adminLogin(h, admins[name] as { email: string; secret: string });
  return bearer(sessions[name]);
}

type Shop = Awaited<ReturnType<typeof approvedShop>>;

/** A paid order of `qty` units from a fresh shop. */
async function paidOrder(qty = 2, priceFils = 10_500, shop?: Shop) {
  const s = shop ?? (await approvedShop(h));
  const product = await listedProduct(h, s, [{ priceFils, stock: 5 }]);
  const variantId = product.variantIds[0] as string;
  const { customer, addressId } = await customerWithAddress(h);
  await addToCart(h, customer, variantId, qty);
  const quote = await quoteFor(h, customer, addressId);
  const order = await placedOrder(h, customer, quote.quoteId);
  await pay(h, order);
  const view = await getOrder(customer, order.orderId);
  expect(view.status).toBe('paid');
  const mo = view.merchants[0] as (typeof view.merchants)[number];
  return { shop: s, product, variantId, customer, orderId: order.orderId, mo };
}

async function getOrder(customer: { tokens: { accessToken: string } }, orderId: string) {
  const res = await h
    .http()
    .get(`/v1/orders/${orderId}`)
    .set('Authorization', bearer(customer))
    .expect(200);
  return orderSchema.parse(res.body);
}

function act(shop: Shop, moId: string, body: Record<string, unknown>) {
  return h
    .http()
    .post(`/v1/businesses/${shop.businessId}/orders/${moId}/fulfillment`)
    .set('Authorization', bearer(shop.owner))
    .send(body);
}

async function delivered(qty = 2) {
  const o = await paidOrder(qty);
  await act(o.shop, o.mo.id, {
    action: 'ship',
    expectedStatus: 'paid',
    carrier: 'Fictional Express',
    trackingNumber: 'FX123',
  }).expect(201);
  await act(o.shop, o.mo.id, { action: 'deliver', expectedStatus: 'shipped' }).expect(201);
  return o;
}

async function outboxIds(type: string, key: string, value: string) {
  const rows = await h.db
    .selectFrom('outbox')
    .select(['id', 'payload'])
    .where('event_type', '=', type)
    .execute();
  return rows.filter((r) => (r.payload as Record<string, unknown>)[key] === value).map((r) => r.id);
}

describe('fulfillment', () => {
  it('moves forward with a version check, needs tracking to ship and records a timeline', async () => {
    const o = await paidOrder();
    await act(o.shop, o.mo.id, { action: 'ship', expectedStatus: 'paid' }).expect(400);
    await act(o.shop, o.mo.id, { action: 'deliver', expectedStatus: 'paid' }).expect(409);
    await act(o.shop, o.mo.id, { action: 'process', expectedStatus: 'paid' }).expect(201);
    const stale = await act(o.shop, o.mo.id, { action: 'process', expectedStatus: 'paid' }).expect(
      409,
    );
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const shipped = merchantOrderSchema.parse(
      (
        await act(o.shop, o.mo.id, {
          action: 'ship',
          expectedStatus: 'processing',
          carrier: 'Fictional Express',
          trackingNumber: 'FX-777',
          trackingUrl: 'https://track.example.test/FX-777',
        }).expect(201)
      ).body,
    );
    expect(shipped.status).toBe('shipped');
    expect(shipped.fulfillment).toMatchObject({
      carrier: 'Fictional Express',
      trackingNumber: 'FX-777',
    });
    await act(o.shop, o.mo.id, {
      action: 'cancel',
      expectedStatus: 'shipped',
      reason: 'Too late',
    }).expect(409);
    await act(o.shop, o.mo.id, { action: 'deliver', expectedStatus: 'shipped' }).expect(201);

    const view = await getOrder(o.customer, o.orderId);
    const m = view.merchants[0]!;
    expect(m.status).toBe('delivered');
    expect(m.fulfillment.timeline.map((e) => e.status)).toEqual([
      'paid',
      'processing',
      'shipped',
      'delivered',
    ]);
    expect(m.canCancel).toBe(false);
    expect(m.canReturn).toBe(true);
    expect(await outboxIds('order.shipped', 'merchantOrderId', o.mo.id)).toHaveLength(1);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', o.mo.id)
      .execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['order.process', 'order.ship', 'order.deliver']),
    );
  });

  it('is scoped to the business in the path (tenant isolation)', async () => {
    const o = await paidOrder();
    const other = await approvedShop(h);
    const res = await h
      .http()
      .post(`/v1/businesses/${other.businessId}/orders/${o.mo.id}/fulfillment`)
      .set('Authorization', bearer(other.owner))
      .send({ action: 'process', expectedStatus: 'paid' });
    expect(res.status).toBe(404);
    const intruder = await h
      .http()
      .post(`/v1/businesses/${o.shop.businessId}/orders/${o.mo.id}/fulfillment`)
      .set('Authorization', bearer(other.owner))
      .send({ action: 'process', expectedStatus: 'paid' });
    expect([403, 404]).toContain(intruder.status);
  });

  it('lets the customer cancel before processing: stock returns and the suborder is refunded', async () => {
    const o = await paidOrder(2);
    expect(o.mo.canCancel).toBe(true);
    const before = await stockOf(h, o.variantId);
    const res = await h
      .http()
      .post(`/v1/orders/${o.orderId}/cancel`)
      .set('Authorization', bearer(o.customer))
      .send({ merchantOrderId: o.mo.id, reason: 'Ordered by mistake' })
      .expect(200);
    expect(orderSchema.parse(res.body).merchants[0]?.status).toBe('canceled');
    expect((await stockOf(h, o.variantId)).stock_on_hand).toBe(before.stock_on_hand + 2);
    await h.deliverWebhooks();
    const refund = await h.db
      .selectFrom('refunds')
      .select(['amount_fils', 'status', 'reason'])
      .where('merchant_order_id', '=', o.mo.id)
      .executeTakeFirstOrThrow();
    expect(refund).toEqual({
      amount_fils: o.mo.totalFils,
      status: 'succeeded',
      reason: 'customer_cancellation',
    });
    // Canceling twice, or after the merchant started, is refused.
    await h
      .http()
      .post(`/v1/orders/${o.orderId}/cancel`)
      .set('Authorization', bearer(o.customer))
      .send({ merchantOrderId: o.mo.id })
      .expect(409);
  });

  it('refuses a customer cancel once processing started, but the merchant can still cancel', async () => {
    const o = await paidOrder(1);
    await act(o.shop, o.mo.id, { action: 'process', expectedStatus: 'paid' }).expect(201);
    const res = await h
      .http()
      .post(`/v1/orders/${o.orderId}/cancel`)
      .set('Authorization', bearer(o.customer))
      .send({ merchantOrderId: o.mo.id })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    await act(o.shop, o.mo.id, { action: 'cancel', expectedStatus: 'processing' }).expect(400);
    await act(o.shop, o.mo.id, {
      action: 'cancel',
      expectedStatus: 'processing',
      reason: 'Item damaged in the warehouse',
    }).expect(201);
    await h.deliverWebhooks();
    const payment = await h.db
      .selectFrom('payments')
      .select('status')
      .where('order_id', '=', o.orderId)
      .executeTakeFirstOrThrow();
    expect(payment.status).toBe('refunded');
  });

  it('lists suborders for admins with orders.view only', async () => {
    const o = await paidOrder(1);
    const res = await h
      .http()
      .get('/v1/admin/orders?status=paid&limit=100')
      .set('Authorization', await as('operations'))
      .expect(200);
    const page = pageSchema(adminOrderSchema).parse(res.body);
    expect(page.items.some((i) => i.id === o.mo.id)).toBe(true);
    await h
      .http()
      .get('/v1/admin/orders')
      .set('Authorization', await as('catalog'))
      .expect(403);
  });
});

describe('returns', () => {
  it('runs requested -> approved -> received -> refunded, refunding only the units returned', async () => {
    const o = await delivered(3);
    const itemId = o.mo.items[0]!.id;
    const auth = bearer(o.customer);
    const created = returnSchema.parse(
      (
        await h
          .http()
          .post(`/v1/orders/${o.orderId}/returns`)
          .set('Authorization', auth)
          .send({
            merchantOrderId: o.mo.id,
            items: [{ orderItemId: itemId, qty: 1 }],
            reason: 'Wrong size',
          })
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({ status: 'requested', amountFils: 10_500 });
    const dup = await h
      .http()
      .post(`/v1/orders/${o.orderId}/returns`)
      .set('Authorization', auth)
      .send({ merchantOrderId: o.mo.id, items: [{ orderItemId: itemId, qty: 1 }], reason: 'Again' })
      .expect(409);
    expect(dup.body.error.code).toBe('RETURN_OPEN');

    const base = `/v1/businesses/${o.shop.businessId}/returns/${created.id}/actions`;
    const owner = bearer(o.shop.owner);
    await h.http().post(base).set('Authorization', owner).send({ action: 'receive' }).expect(409);
    await h.http().post(base).set('Authorization', owner).send({ action: 'reject' }).expect(400);
    await h.http().post(base).set('Authorization', owner).send({ action: 'approve' }).expect(201);
    const received = returnSchema.parse(
      (
        await h
          .http()
          .post(base)
          .set('Authorization', owner)
          .send({ action: 'receive' })
          .expect(201)
      ).body,
    );
    expect(received.status).toBe('refund_pending');
    await h.deliverWebhooks();
    const done = returnSchema.parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${o.shop.businessId}/returns/${created.id}`)
          .set('Authorization', owner)
          .expect(200)
      ).body,
    );
    expect(done.status).toBe('refunded');
    const refund = await h.db
      .selectFrom('refunds')
      .select(['amount_fils', 'reason', 'status'])
      .where('return_request_id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(refund).toEqual({ amount_fils: 10_500, reason: 'return', status: 'succeeded' });
    expect(await outboxIds('return.refunded', 'returnId', created.id)).toHaveLength(1);

    // The other two units can still be returned; asking for three is refused.
    const over = await h
      .http()
      .post(`/v1/orders/${o.orderId}/returns`)
      .set('Authorization', auth)
      .send({
        merchantOrderId: o.mo.id,
        items: [{ orderItemId: itemId, qty: 3 }],
        reason: 'All of it',
      })
      .expect(422);
    expect(over.body.error.code).toBe('RETURN_EXCEEDS_PURCHASE');
    const mine = pageSchema(returnSchema).parse(
      (await h.http().get('/v1/me/returns').set('Authorization', auth).expect(200)).body,
    );
    expect(mine.items.map((r) => r.id)).toContain(created.id);
  });

  it('needs delivery, and closes 14 days after it', async () => {
    const o = await paidOrder(1);
    const body = {
      merchantOrderId: o.mo.id,
      items: [{ orderItemId: o.mo.items[0]!.id, qty: 1 }],
      reason: 'Changed my mind',
    };
    const early = await h
      .http()
      .post(`/v1/orders/${o.orderId}/returns`)
      .set('Authorization', bearer(o.customer))
      .send(body)
      .expect(409);
    expect(early.body.error.code).toBe('NOT_DELIVERED');
    const long = new Date(h.clock.now().getTime() - 15 * 86_400_000);
    await h.db
      .updateTable('merchant_orders')
      .set({
        status: 'delivered',
        shipped_at: long,
        delivered_at: long,
        carrier: 'X',
        tracking_number: '1',
      })
      .where('id', '=', o.mo.id)
      .execute();
    const late = await h
      .http()
      .post(`/v1/orders/${o.orderId}/returns`)
      .set('Authorization', bearer(o.customer))
      .send(body)
      .expect(422);
    expect(late.body.error.code).toBe('RETURN_WINDOW_CLOSED');
  });
});

describe('reviews (T10)', () => {
  it('allows one review per delivered item, with merchant replies and admin moderation', async () => {
    const o = await paidOrder(1);
    const itemId = o.mo.items[0]!.id;
    const auth = bearer(o.customer);
    const early = await h
      .http()
      .post('/v1/reviews')
      .set('Authorization', auth)
      .send({ orderItemId: itemId, rating: 5 })
      .expect(422);
    expect(early.body.error.code).toBe('NOT_REVIEWABLE');
    await act(o.shop, o.mo.id, {
      action: 'ship',
      expectedStatus: 'paid',
      carrier: 'Fictional Express',
      trackingNumber: 'FX1',
    }).expect(201);
    await act(o.shop, o.mo.id, { action: 'deliver', expectedStatus: 'shipped' }).expect(201);
    // Someone else cannot review this item.
    const stranger = await signUp(h, uniqueEmail('stranger'));
    await h
      .http()
      .post('/v1/reviews')
      .set('Authorization', bearer(stranger))
      .send({ orderItemId: itemId, rating: 1 })
      .expect(404);
    const review = myReviewSchema.parse(
      (
        await h
          .http()
          .post('/v1/reviews')
          .set('Authorization', auth)
          .send({ orderItemId: itemId, rating: 4, body: 'Good quality, fictional review.' })
          .expect(201)
      ).body,
    );
    const again = await h
      .http()
      .post('/v1/reviews')
      .set('Authorization', auth)
      .send({ orderItemId: itemId, rating: 1 })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_REVIEWED');

    const pub = async () =>
      reviewSummarySchema.parse(
        (await h.http().get(`/v1/products/${o.product.productId}/reviews`).expect(200)).body,
      );
    expect(await pub()).toMatchObject({ average: 4, count: 1 });

    const owner = bearer(o.shop.owner);
    const biz = `/v1/businesses/${o.shop.businessId}/reviews/${review.id}`;
    await h
      .http()
      .post(`${biz}/replies`)
      .set('Authorization', owner)
      .send({ body: 'Thank you!' })
      .expect(201);
    const replied = merchantReviewSchema.parse(
      (
        await h
          .http()
          .post(`${biz}/replies`)
          .set('Authorization', owner)
          .send({ body: 'Thanks again.' })
          .expect(201)
      ).body,
    );
    expect(replied.replies.map((r) => r.body)).toEqual(['Thank you!', 'Thanks again.']);
    expect((await pub()).items[0]?.reply?.body).toBe('Thanks again.');
    await h
      .http()
      .post(`${biz}/report`)
      .set('Authorization', owner)
      .send({ reason: 'Not a real buyer' })
      .expect(201);
    await h
      .http()
      .post(`${biz}/report`)
      .set('Authorization', owner)
      .send({ reason: 'Again' })
      .expect(409);

    // Merchants report; only admins with reviews.moderate hide.
    const mod = `/v1/admin/reviews/${review.id}/moderation`;
    await h
      .http()
      .post(mod)
      .set('Authorization', await as('finance'))
      .send({ action: 'hide', reason: 'x'.repeat(5) })
      .expect(403);
    const queue = pageSchema(adminReviewSchema).parse(
      (
        await h
          .http()
          .get('/v1/admin/reviews?limit=100')
          .set('Authorization', await as('support'))
          .expect(200)
      ).body,
    );
    expect(queue.items.find((r) => r.id === review.id)?.reported).toBe(true);
    const hidden = adminReviewSchema.parse(
      (
        await h
          .http()
          .post(mod)
          .set('Authorization', await as('support'))
          .send({ action: 'hide', reason: 'Contains personal details' })
          .expect(201)
      ).body,
    );
    expect(hidden).toMatchObject({
      status: 'hidden',
      reported: false,
      hiddenReason: 'Contains personal details',
    });
    expect(await pub()).toMatchObject({ average: null, count: 0, items: [] });
    await h
      .http()
      .post(mod)
      .set('Authorization', await as('support'))
      .send({ action: 'restore', reason: 'Details removed by the customer' })
      .expect(201);
    expect((await pub()).count).toBe(1);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', review.id)
      .execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'review.create',
        'review.reply',
        'review.report',
        'review.hide',
        'review.restore',
      ]),
    );
  });

  it('allows a review only after an appointment is completed', async () => {
    const v = await approvedVenue(h);
    const user = await signUp(h, uniqueEmail('rev-booker'));
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('10:00'),
    });
    await h
      .http()
      .post('/v1/reviews')
      .set('Authorization', bearer(user))
      .send({ bookingId: booking.id, rating: 5 })
      .expect(422);
    await h.db
      .updateTable('bookings')
      .set({ status: 'completed', checked_in_at: h.clock.now(), completed_at: h.clock.now() })
      .where('id', '=', booking.id)
      .execute();
    await h
      .http()
      .post('/v1/reviews')
      .set('Authorization', bearer(user))
      .send({ bookingId: booking.id, rating: 5, body: 'Lovely fictional service.' })
      .expect(201);
    const venue = reviewSummarySchema.parse(
      (await h.http().get(`/v1/venues/${v.businessId}/reviews`).expect(200)).body,
    );
    expect(venue).toMatchObject({ average: 5, count: 1 });
  });
});

describe('support', () => {
  it('keeps internal notes from the customer and reopens a resolved ticket on reply', async () => {
    const o = await paidOrder(1);
    const auth = bearer(o.customer);
    const stranger = await signUp(h, uniqueEmail('nosy'));
    await h
      .http()
      .post('/v1/support/tickets')
      .set('Authorization', bearer(stranger))
      .send({ type: 'order', orderId: o.orderId, subject: 'Where is it?', body: 'Hello' })
      .expect(404);
    const ticket = ticketSchema.parse(
      (
        await h
          .http()
          .post('/v1/support/tickets')
          .set('Authorization', auth)
          .send({
            type: 'order',
            orderId: o.orderId,
            subject: 'Where is my order?',
            body: 'It has been a while.',
          })
          .expect(201)
      ).body,
    );
    expect(ticket.status).toBe('open');
    const path = `/v1/admin/support/tickets/${ticket.id}`;
    await h
      .http()
      .get(path)
      .set('Authorization', await as('finance'))
      .expect(403);
    const sup = await as('support');
    await h
      .http()
      .post(`${path}/messages`)
      .set('Authorization', sup)
      .send({ body: 'Customer seems upset.', internal: true })
      .expect(201);
    const replied = adminTicketSchema.parse(
      (
        await h
          .http()
          .post(`${path}/messages`)
          .set('Authorization', sup)
          .send({ body: 'We are checking with the seller.' })
          .expect(201)
      ).body,
    );
    expect(replied.status).toBe('awaiting_reply');
    expect(replied.assignedTo?.id).toBe(admins.support?.id);
    expect(replied.messages).toHaveLength(3);

    const seen = ticketSchema.parse(
      (
        await h
          .http()
          .get(`/v1/support/tickets/${ticket.id}`)
          .set('Authorization', auth)
          .expect(200)
      ).body,
    );
    expect(seen.messages.map((m) => m.body)).toEqual([
      'It has been a while.',
      'We are checking with the seller.',
    ]);
    expect(seen.messages.some((m) => m.internal)).toBe(false);
    expect(await outboxIds('ticket.replied', 'ticketId', ticket.id)).toHaveLength(1);

    await h
      .http()
      .post(`/v1/support/tickets/${ticket.id}/messages`)
      .set('Authorization', auth)
      .send({ body: 'Thanks' })
      .expect(201);
    await h
      .http()
      .post(`${path}/actions`)
      .set('Authorization', sup)
      .send({ action: 'resolve' })
      .expect(201);
    await h
      .http()
      .post(`${path}/messages`)
      .set('Authorization', sup)
      .send({ body: 'Anything else?' })
      .expect(409);
    const reopened = ticketSchema.parse(
      (
        await h
          .http()
          .post(`/v1/support/tickets/${ticket.id}/messages`)
          .set('Authorization', auth)
          .send({ body: 'Still missing.' })
          .expect(201)
      ).body,
    );
    expect(reopened.status).toBe('reopened');
  });
});

describe('notifications (T12)', () => {
  const dispatcher = () => h.app.get(NotificationsService);

  it('notifies the customer in-app and by email once, retrying a failed send with backoff', async () => {
    const o = await paidOrder(1);
    await act(o.shop, o.mo.id, {
      action: 'ship',
      expectedStatus: 'paid',
      carrier: 'Fictional Express',
      trackingNumber: 'FX-T12',
    }).expect(201);
    const [id] = await outboxIds('order.shipped', 'merchantOrderId', o.mo.id);
    h.notifier.failNext(1);
    await dispatcher().dispatch(10, [id!]);
    const first = await h.db
      .selectFrom('outbox')
      .selectAll()
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(first).toMatchObject({ status: 'pending', attempts: 1 });
    expect(first.available_at.getTime()).toBeGreaterThan(h.clock.now().getTime() + 25_000);
    expect(first.last_error).toContain('unavailable');
    // Not due yet: nothing happens.
    expect(await dispatcher().dispatch(10, [id!])).toBe(0);
    await h.db
      .updateTable('outbox')
      .set({ available_at: h.clock.now() })
      .where('id', '=', id!)
      .execute();
    await dispatcher().dispatch(10, [id!]);
    await h.db.updateTable('outbox').set({ status: 'pending' }).where('id', '=', id!).execute();
    await dispatcher().dispatch(10, [id!]); // a replay must not duplicate anything
    const after = await h.db
      .selectFrom('outbox')
      .select('status')
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('sent');
    const deliveries = await h.db
      .selectFrom('notification_deliveries')
      .select('id')
      .where('outbox_id', '=', id!)
      .execute();
    expect(deliveries).toHaveLength(1);
    const emails = h.notifier.sent.filter(
      (m) => m.to === o.customer.email && m.template === 'notification',
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]?.params.title).toContain('on its way');

    const page = notificationPageSchema.parse(
      (
        await h
          .http()
          .get('/v1/me/notifications')
          .set('Authorization', bearer(o.customer))
          .expect(200)
      ).body,
    );
    const n = page.items.find((i) => i.eventType === 'order.shipped');
    expect(n?.body).toContain('FX-T12');
    expect(n?.link).toBe(`/orders/${o.orderId}`);
    expect(page.unread).toBeGreaterThan(0);
    const read = notificationPageSchema.parse(
      (
        await h
          .http()
          .post('/v1/me/notifications/read')
          .set('Authorization', bearer(o.customer))
          .send({})
          .expect(200)
      ).body,
    );
    expect(read.unread).toBe(0);
  });

  it('marks an event failed after the last attempt and shows it on outbox health', async () => {
    const o = await paidOrder(1);
    await act(o.shop, o.mo.id, {
      action: 'ship',
      expectedStatus: 'paid',
      carrier: 'Fictional Express',
      trackingNumber: 'FX-FAIL',
    }).expect(201);
    const [id] = await outboxIds('order.shipped', 'merchantOrderId', o.mo.id);
    h.notifier.failNext(NOTIFICATION_MAX_ATTEMPTS);
    for (let i = 0; i < NOTIFICATION_MAX_ATTEMPTS; i += 1) {
      await h.db
        .updateTable('outbox')
        .set({ available_at: h.clock.now() })
        .where('id', '=', id!)
        .execute();
      await dispatcher().dispatch(10, [id!]);
    }
    const row = await h.db
      .selectFrom('outbox')
      .select(['status', 'attempts'])
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'failed', attempts: NOTIFICATION_MAX_ATTEMPTS });
    const health = outboxHealthSchema.parse(
      (
        await h
          .http()
          .get('/v1/admin/notifications/health')
          .set('Authorization', await as('operations'))
          .expect(200)
      ).body,
    );
    expect(health.failed).toBeGreaterThan(0);
  });

  it('versions templates and refuses placeholders the event does not provide', async () => {
    const ops = await as('operations');
    await h
      .http()
      .get('/v1/admin/notifications/templates')
      .set('Authorization', await as('finance'))
      .expect(403);
    const bad = await h
      .http()
      .post('/v1/admin/notifications/templates')
      .set('Authorization', ops)
      .send({ eventType: 'order.shipped', locale: 'en', title: 'Hi {name}', body: 'x' })
      .expect(422);
    expect(bad.body.error.code).toBe('UNKNOWN_PLACEHOLDER');
    await h
      .http()
      .post('/v1/admin/notifications/templates')
      .set('Authorization', ops)
      .send({ eventType: 'order.unknown', locale: 'en', title: 'Hi', body: 'x' })
      .expect(422);
    const list = z
      .array(notificationTemplateSchema)
      .parse(
        (
          await h
            .http()
            .post('/v1/admin/notifications/templates')
            .set('Authorization', ops)
            .send({
              eventType: 'ticket.replied',
              locale: 'en',
              title: 'New reply: {subject}',
              body: 'Open the conversation to read it.',
            })
            .expect(201)
        ).body,
      );
    const t = list.find((x) => x.eventType === 'ticket.replied' && x.locale === 'en');
    expect(t?.title).toBe('New reply: {subject}');
    expect(t?.version).toBeGreaterThan(1);
    expect(t?.updatedBy?.id).toBe(admins.operations?.id);
  });
});

describe('dashboards and exports', () => {
  it('shows a business its sales and refunds for the range', async () => {
    const o = await paidOrder(2);
    const res = await h
      .http()
      .get(`/v1/businesses/${o.shop.businessId}/dashboard`)
      .set('Authorization', bearer(o.shop.owner))
      .expect(200);
    const d = businessDashboardSchema.parse(res.body);
    expect(d.services).toBeNull();
    expect(d.shop?.grossSalesFils).toBe(o.mo.totalFils);
    expect(d.shop?.orders.paid).toBe(1);
    expect(d.shop?.daily).toHaveLength(30);
    await h
      .http()
      .get(`/v1/businesses/${o.shop.businessId}/dashboard?from=2027-01-10&to=2026-01-01`)
      .set('Authorization', bearer(o.shop.owner))
      .expect(400);
  });

  it('shows the platform dashboard to admins with orders.view', async () => {
    const res = await h
      .http()
      .get('/v1/admin/dashboard')
      .set('Authorization', await as('analyst'))
      .expect(200);
    const d = adminDashboardSchema.parse(res.body);
    expect(d.daily).toHaveLength(30);
    await h
      .http()
      .get('/v1/admin/dashboard')
      .set('Authorization', await as('catalog'))
      .expect(403);
  });

  it('exports CSV without contact details and audits every export', async () => {
    const o = await paidOrder(1);
    const day = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const q = `from=${from}&to=${day}`;
    await h
      .http()
      .get(`/v1/admin/exports/orders?${q}`)
      .set('Authorization', await as('operations'))
      .expect(403);
    await h
      .http()
      .get(`/v1/admin/exports/secrets?${q}`)
      .set('Authorization', await as('finance'))
      .expect(404);
    const res = await h
      .http()
      .get(`/v1/admin/exports/orders?${q}`)
      .set('Authorization', await as('finance'))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('suborder_id,order_id');
    expect(res.text).toContain(o.mo.id);
    expect(res.text).not.toContain(o.customer.email);
    const statement = await h
      .http()
      .get(`/v1/businesses/${o.shop.businessId}/finance/statement?${q}`)
      .set('Authorization', bearer(o.shop.owner))
      .expect(200);
    expect(statement.text).toContain('earning_id');
    const audits = await h.db
      .selectFrom('audit_logs')
      .select(['actor_id', 'redacted_diff'])
      .where('action', '=', 'export.created')
      .where('actor_id', 'in', [admins.finance!.id, o.shop.owner.user.id])
      .execute();
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });
});
