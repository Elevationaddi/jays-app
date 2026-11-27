import { randomUUID } from 'node:crypto';
import {
  cartSchema,
  createOrderResponseSchema,
  merchantOrderSchema,
  orderSchema,
  pageSchema,
  merchantOrderListItemSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signWebhook } from '../payments/mock-provider.js';
import { WEBHOOK_SIGNATURE_HEADER } from '../payments/provider.js';
import {
  addToCart,
  approvedShop,
  customerWithAddress,
  endPaymentWindow,
  listedProduct,
  pay,
  placedOrder,
  placeOrder,
  quoteFor,
  runExpiry,
  stockOf,
} from '../testing/commerce.js';
import { testEnv } from '../testing/test-env.js';
import { bearer, type Harness, signUp, startHarness, uniqueEmail } from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const getOrder = async (session: { tokens: { accessToken: string } }, id: string) =>
  orderSchema.parse(
    (await h.http().get(`/v1/orders/${id}`).set('Authorization', bearer(session)).expect(200)).body,
  );

describe('T04: concurrent purchases of the last unit', () => {
  it('lets exactly one of two simultaneous checkouts reserve the last unit', async () => {
    const shop = await approvedShop(h);
    const { variantIds } = await listedProduct(h, shop, [{ priceFils: 9_900, stock: 1 }]);
    const v = variantIds[0] as string;
    const buyers = await Promise.all([customerWithAddress(h), customerWithAddress(h)]);
    const quotes: { quoteId: string }[] = [];
    for (const b of buyers) {
      await addToCart(h, b.customer, v, 1);
      quotes.push(await quoteFor(h, b.customer, b.addressId));
    }
    const results = await Promise.all(
      buyers.map((b, i) => placeOrder(h, b.customer, quotes[i]?.quoteId as string)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser?.body.error.code).toBe('OUT_OF_STOCK');
    expect(await stockOf(h, v)).toEqual({ stock_on_hand: 1, stock_reserved: 1 });
  });

  it('never oversells under a burst of checkouts', async () => {
    const shop = await approvedShop(h);
    const { variantIds } = await listedProduct(h, shop, [{ priceFils: 1_000, stock: 3 }]);
    const v = variantIds[0] as string;
    const buyers = await Promise.all(Array.from({ length: 8 }, () => customerWithAddress(h)));
    const quotes: { quoteId: string }[] = [];
    for (const b of buyers) {
      await addToCart(h, b.customer, v, 1);
      quotes.push(await quoteFor(h, b.customer, b.addressId));
    }
    const results = await Promise.all(
      buyers.map((b, i) => placeOrder(h, b.customer, quotes[i]?.quoteId as string)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await stockOf(h, v)).toEqual({ stock_on_hand: 3, stock_reserved: 3 });
  });
});

describe('T05: multi-seller checkout', () => {
  it('splits into suborders whose delivery, tax and totals reconcile, and pays them together', async () => {
    const shopA = await approvedShop(h, [{ emirate: 'DXB', feeFils: 1_500 }]);
    const shopB = await approvedShop(h, [{ emirate: 'DXB', feeFils: 2_000, freeOverFils: 10_000 }]);
    const a = await listedProduct(h, shopA, [
      { priceFils: 10_500, stock: 5 },
      { priceFils: 3_000, stock: 5, taxClass: 'zero_rated' },
    ]);
    const b = await listedProduct(h, shopB, [{ priceFils: 6_000, stock: 5 }]);
    const { customer, addressId } = await customerWithAddress(h);
    await addToCart(h, customer, a.variantIds[0] as string, 2);
    await addToCart(h, customer, a.variantIds[1] as string, 1);
    const cart = await addToCart(h, customer, b.variantIds[0] as string, 2);
    expect(cart.groups).toHaveLength(2);
    expect(cart.checkoutReady).toBe(true);

    const quote = await quoteFor(h, customer, addressId);
    const groupA = quote.groups.find((g) => g.store.id === shopA.businessId);
    const groupB = quote.groups.find((g) => g.store.id === shopB.businessId);
    expect(groupA).toMatchObject({ subtotalFils: 24_000, deliveryFils: 1_500, totalFils: 25_500 });
    expect(groupB).toMatchObject({ subtotalFils: 12_000, deliveryFils: 0, totalFils: 12_000 });
    // VAT-inclusive prices: 21000 standard-rated -> 1000 tax; zero-rated line 0; delivery 1500 -> 71.
    expect(groupA?.taxFils).toBe(1_000 + 0 + 71);
    expect(quote.totalFils).toBe(37_500);
    expect(quote.totalFils).toBe(quote.groups.reduce((s, g) => s + g.totalFils, 0));
    expect(quote.taxFils).toBe(quote.groups.reduce((s, g) => s + g.taxFils, 0));

    const key = `checkout-${randomUUID()}`;
    const first = createOrderResponseSchema.parse(
      (await placeOrder(h, customer, quote.quoteId, key).expect(201)).body,
    );
    const retry = createOrderResponseSchema.parse(
      (await placeOrder(h, customer, quote.quoteId, key).expect(201)).body,
    );
    const otherKey = createOrderResponseSchema.parse(
      (await placeOrder(h, customer, quote.quoteId).expect(201)).body,
    );
    expect(retry.orderId).toBe(first.orderId);
    expect(otherKey.orderId).toBe(first.orderId);
    expect(first).toMatchObject({ status: 'pending_payment', totalFils: 37_500 });
    expect(first.paymentClientSecret).toMatch(/^pi_secret_/);
    const quote2 = await quoteFor(h, customer, addressId);
    expect((await placeOrder(h, customer, quote2.quoteId, key).expect(409)).body.error.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(
      await h.db.selectFrom('orders').select('id').where('quote_id', '=', quote.quoteId).execute(),
    ).toHaveLength(1);

    let order = await getOrder(customer, first.orderId);
    expect(order.merchants).toHaveLength(2);
    expect(order.merchants.reduce((s, m) => s + m.totalFils, 0)).toBe(order.totalFils);
    expect(order.merchants.every((m) => m.status === 'pending_payment')).toBe(true);
    expect(await stockOf(h, a.variantIds[0] as string)).toEqual({
      stock_on_hand: 5,
      stock_reserved: 2,
    });

    const responses = await pay(h, first);
    expect(responses).toEqual([{ status: 200, body: { received: true, duplicate: false } }]);
    order = await getOrder(customer, first.orderId);
    expect(order.status).toBe('paid');
    expect(order.paymentStatus).toBe('succeeded');
    expect(order.paymentClientSecret).toBeNull();
    expect(order.merchants.every((m) => m.status === 'paid')).toBe(true);
    expect(await stockOf(h, a.variantIds[0] as string)).toEqual({
      stock_on_hand: 3,
      stock_reserved: 0,
    });
    const sales = await h.db
      .selectFrom('stock_movements')
      .select(['delta', 'reason'])
      .where('order_id', '=', first.orderId)
      .execute();
    expect(sales.map((s) => s.delta).sort()).toEqual([-1, -2, -2]);
    // Bought lines left the cart.
    const after = cartSchema.parse(
      (await h.http().get('/v1/cart').set('Authorization', bearer(customer)).expect(200)).body,
    );
    expect(after.itemCount).toBe(0);

    // Each merchant sees only its own suborder (T03).
    const listA = pageSchema(merchantOrderListItemSchema).parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${shopA.businessId}/orders`)
          .set('Authorization', bearer(shopA.owner))
          .expect(200)
      ).body,
    );
    expect(listA.items).toHaveLength(1);
    const subA = merchantOrderSchema.parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${shopA.businessId}/orders/${listA.items[0]?.id}`)
          .set('Authorization', bearer(shopA.owner))
          .expect(200)
      ).body,
    );
    expect(subA.items).toHaveLength(2);
    expect(subA.address.emirate).toBe('DXB');
    await h
      .http()
      .get(`/v1/businesses/${shopB.businessId}/orders/${subA.id}`)
      .set('Authorization', bearer(shopB.owner))
      .expect(404);
    // Another customer cannot see the order.
    const stranger = await signUp(h, uniqueEmail('stranger'));
    await h
      .http()
      .get(`/v1/orders/${first.orderId}`)
      .set('Authorization', bearer(stranger))
      .expect(404);
  });

  it('refuses sellers that do not deliver to the address and empty carts', async () => {
    const shop = await approvedShop(h, [{ emirate: 'DXB', feeFils: 1_000 }]);
    const { variantIds } = await listedProduct(h, shop);
    const { customer, addressId } = await customerWithAddress(h, 'FUJ');
    expect(
      (
        await h
          .http()
          .post('/v1/checkout/quote')
          .set('Authorization', bearer(customer))
          .send({ addressId })
          .expect(422)
      ).body.error.code,
    ).toBe('CART_EMPTY');
    await addToCart(h, customer, variantIds[0] as string, 1);
    const res = await h
      .http()
      .post('/v1/checkout/quote')
      .set('Authorization', bearer(customer))
      .send({ addressId })
      .expect(422);
    expect(res.body.error).toMatchObject({
      code: 'DELIVERY_UNAVAILABLE',
      fieldErrors: { stores: [shop.businessId] },
    });
  });
});

describe('T06: failed, expired and late payments; webhook replay', () => {
  async function pendingOrder(stock = 2, qty = 1) {
    const shop = await approvedShop(h);
    const { variantIds } = await listedProduct(h, shop, [{ priceFils: 5_000, stock }]);
    const v = variantIds[0] as string;
    const { customer, addressId } = await customerWithAddress(h);
    await addToCart(h, customer, v, qty);
    const quote = await quoteFor(h, customer, addressId);
    const order = await placedOrder(h, customer, quote.quoteId);
    return { v, customer, order };
  }

  it('releases the reservation when the payment fails', async () => {
    const { v, customer, order } = await pendingOrder();
    expect(await stockOf(h, v)).toEqual({ stock_on_hand: 2, stock_reserved: 1 });
    await pay(h, order, 'fail');
    const after = await getOrder(customer, order.orderId);
    expect(after.status).toBe('failed');
    expect(after.merchants[0]).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_failed',
    });
    expect(await stockOf(h, v)).toEqual({ stock_on_hand: 2, stock_reserved: 0 });
  });

  it('expires an unpaid order after the payment window and refunds a late payment', async () => {
    const { v, customer, order } = await pendingOrder();
    // timeout: the provider never calls back.
    expect(await pay(h, order, 'timeout')).toEqual([]);
    await runExpiry(h);
    expect((await getOrder(customer, order.orderId)).status).toBe('pending_payment');
    await endPaymentWindow(h, order.orderId);
    expect(await runExpiry(h)).toBeGreaterThanOrEqual(1);
    let after = await getOrder(customer, order.orderId);
    expect(after.status).toBe('expired');
    expect(after.merchants[0]).toMatchObject({
      status: 'canceled',
      cancelReason: 'payment_expired',
    });
    expect(await stockOf(h, v)).toEqual({ stock_on_hand: 2, stock_reserved: 0 });

    // The customer completes payment anyway, after expiry.
    h.psp.confirm(order.paymentIntentId as string, order.paymentClientSecret as string, 'success');
    await h.deliverWebhooks(); // payment succeeded -> refund requested (refund webhook queued)
    await h.deliverWebhooks(); // refund succeeded
    after = await getOrder(customer, order.orderId);
    expect(after.status).toBe('expired');
    expect(after.paymentStatus).toBe('refunded');
    expect(await stockOf(h, v)).toEqual({ stock_on_hand: 2, stock_reserved: 0 });
    const refunds = await h.db
      .selectFrom('refunds as r')
      .innerJoin('payments as p', 'p.id', 'r.payment_id')
      .select(['r.status', 'r.amount_fils', 'r.reason'])
      .where('p.order_id', '=', order.orderId)
      .execute();
    expect(refunds).toEqual([
      { status: 'succeeded', amount_fils: after.totalFils, reason: 'late_payment' },
    ]);
  });

  it('flags a late payment for operations when the automatic refund fails', async () => {
    const { customer, order } = await pendingOrder();
    await endPaymentWindow(h, order.orderId);
    await runExpiry(h);
    h.psp.failRefunds = true;
    try {
      h.psp.confirm(
        order.paymentIntentId as string,
        order.paymentClientSecret as string,
        'success',
      );
      await h.deliverWebhooks();
    } finally {
      h.psp.failRefunds = false;
    }
    const after = await getOrder(customer, order.orderId);
    expect(after.paymentStatus).toBe('refund_failed');
    const payment = await h.db
      .selectFrom('payments')
      .select('needs_attention')
      .where('order_id', '=', order.orderId)
      .executeTakeFirstOrThrow();
    expect(payment.needs_attention).toBe(true);
    const events = await h.db
      .selectFrom('outbox')
      .select('event_type')
      .where('event_type', '=', 'payment.manual_exception')
      .where('payload', '@>', JSON.stringify({ orderId: order.orderId }))
      .execute();
    expect(events).toHaveLength(1);
  });

  it('applies a duplicated or replayed webhook exactly once', async () => {
    const { v, customer, order } = await pendingOrder(3, 2);
    const results = await pay(h, order, 'duplicate');
    expect(results.map((r) => r.body)).toEqual([
      { received: true, duplicate: false },
      { received: true, duplicate: true },
    ]);
    expect((await getOrder(customer, order.orderId)).status).toBe('paid');
    expect(await stockOf(h, v)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
    const sales = await h.db
      .selectFrom('stock_movements')
      .select('id')
      .where('order_id', '=', order.orderId)
      .execute();
    expect(sales).toHaveLength(1);
  });

  it('rejects unsigned, tampered and stale webhooks', async () => {
    const secret = testEnv().PSP_WEBHOOK_SECRET;
    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: 'payment_intent.succeeded',
      data: { intentId: 'pi_x', amountFils: 1, currency: 'AED' },
    });
    const post = (b: string, sig?: string) => {
      const req = h.http().post('/v1/webhooks/payments').set('Content-Type', 'application/json');
      return (sig ? req.set(WEBHOOK_SIGNATURE_HEADER, sig) : req).send(b);
    };
    expect((await post(body).expect(401)).body.error.code).toBe('INVALID_SIGNATURE');
    const sig = signWebhook(secret, body, h.clock.now());
    await post(body.replace('"amountFils":1', '"amountFils":2'), sig).expect(401);
    await post(body, signWebhook('local-dev-only-wrong-secret', body, h.clock.now())).expect(401);
    await post(
      body,
      signWebhook(secret, body, new Date(h.clock.now().getTime() - 10 * 60_000)),
    ).expect(401);
    // A correctly signed event for an unknown intent is recorded and ignored.
    expect((await post(body, sig).expect(200)).body).toEqual({ received: true, duplicate: false });
  });
});

describe('quotes, prices and history (T13)', () => {
  it('refuses a stale or expired quote and never rewrites a placed order', async () => {
    const shop = await approvedShop(h);
    const { variantIds } = await listedProduct(h, shop, [{ priceFils: 8_000, stock: 10 }]);
    const v = variantIds[0] as string;
    const { customer, addressId } = await customerWithAddress(h);
    await addToCart(h, customer, v, 1);
    const quote = await quoteFor(h, customer, addressId);
    await h
      .http()
      .patch(`/v1/businesses/${shop.businessId}/variants/${v}`)
      .set('Authorization', bearer(shop.owner))
      .send({ priceFils: 9_000 })
      .expect(200);
    expect((await placeOrder(h, customer, quote.quoteId).expect(409)).body.error.code).toBe(
      'QUOTE_STALE',
    );
    const cart = cartSchema.parse(
      (await h.http().get('/v1/cart').set('Authorization', bearer(customer)).expect(200)).body,
    );
    expect(cart.groups[0]?.lines[0]?.issues).toEqual(['price_changed']);

    const fresh = await quoteFor(h, customer, addressId);
    const order = await placedOrder(h, customer, fresh.quoteId);
    await h
      .http()
      .patch(`/v1/businesses/${shop.businessId}/variants/${v}`)
      .set('Authorization', bearer(shop.owner))
      .send({ priceFils: 1_000 })
      .expect(200);
    await h
      .http()
      .patch(
        `/v1/businesses/${shop.businessId}/products/${(await h.db.selectFrom('variants').select('product_id').where('id', '=', v).executeTakeFirstOrThrow()).product_id}`,
      )
      .set('Authorization', bearer(shop.owner))
      .send({ title: { en: 'Changed later', ar: 'تغير لاحقا' } })
      .expect(200);
    const view = await getOrder(customer, order.orderId);
    expect(view.merchants[0]?.items[0]).toMatchObject({
      unitPriceFils: 9_000,
      title: { en: 'Fictional Serum' },
    });

    const late = await quoteFor(h, customer, addressId);
    await h.db
      .updateTable('quotes')
      .set({ expires_at: new Date(h.clock.now().getTime() - 1000) })
      .where('id', '=', late.quoteId)
      .execute();
    expect((await placeOrder(h, customer, late.quoteId).expect(409)).body.error.code).toBe(
      'QUOTE_EXPIRED',
    );
  });

  it('keeps stock held when the provider is down and succeeds on retry', async () => {
    const shop = await approvedShop(h);
    const { variantIds } = await listedProduct(h, shop, [{ priceFils: 2_500, stock: 1 }]);
    const { customer, addressId } = await customerWithAddress(h);
    await addToCart(h, customer, variantIds[0] as string, 1);
    const quote = await quoteFor(h, customer, addressId);
    const key = `retry-${randomUUID()}`;
    h.psp.unavailable = true;
    try {
      expect((await placeOrder(h, customer, quote.quoteId, key).expect(503)).body.error.code).toBe(
        'PAYMENT_PROVIDER_UNAVAILABLE',
      );
    } finally {
      h.psp.unavailable = false;
    }
    expect(await stockOf(h, variantIds[0] as string)).toEqual({
      stock_on_hand: 1,
      stock_reserved: 1,
    });
    const order = createOrderResponseSchema.parse(
      (await placeOrder(h, customer, quote.quoteId, key).expect(201)).body,
    );
    expect(order.paymentIntentId).toMatch(/^pi_mock_/);
  });
});

describe('cart (T01: guest cart kept on sign-in)', () => {
  it('keeps a guest cart and merges it into the account after sign-in', async () => {
    const shop = await approvedShop(h);
    const { variantIds } = await listedProduct(h, shop, [
      { priceFils: 1_200, stock: 10 },
      { priceFils: 2_400, stock: 0 },
    ]);
    const guest = cartSchema.parse(
      (await h.http().put(`/v1/cart/items/${variantIds[0]}`).send({ qty: 2 }).expect(200)).body,
    );
    expect(guest.cartToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const token = guest.cartToken as string;
    const again = cartSchema.parse(
      (await h.http().get('/v1/cart').set('X-Cart-Token', token).expect(200)).body,
    );
    expect(again.itemCount).toBe(2);
    // Out of stock cannot be added; too many is refused with the available count.
    expect(
      (
        await h
          .http()
          .put(`/v1/cart/items/${variantIds[1]}`)
          .set('X-Cart-Token', token)
          .send({ qty: 1 })
          .expect(409)
      ).body.error.code,
    ).toBe('OUT_OF_STOCK');
    expect(
      (
        await h
          .http()
          .put(`/v1/cart/items/${variantIds[0]}`)
          .set('X-Cart-Token', token)
          .send({ qty: 11 })
          .expect(409)
      ).body.error.code,
    ).toBe('INSUFFICIENT_STOCK');
    await h
      .http()
      .put(`/v1/cart/items/${randomUUID()}`)
      .set('X-Cart-Token', token)
      .send({ qty: 1 })
      .expect(404);

    const user = await signUp(h, uniqueEmail('merge'));
    await addToCart(h, user, variantIds[0] as string, 1);
    const merged = cartSchema.parse(
      (
        await h
          .http()
          .post('/v1/cart/merge')
          .set('Authorization', bearer(user))
          .send({ cartToken: token })
          .expect(200)
      ).body,
    );
    expect(merged.itemCount).toBe(3);
    expect(merged.cartToken).toBeNull();
    const twice = cartSchema.parse(
      (
        await h
          .http()
          .post('/v1/cart/merge')
          .set('Authorization', bearer(user))
          .send({ cartToken: token })
          .expect(200)
      ).body,
    );
    expect(twice.itemCount).toBe(3);
    // The old guest token no longer has a cart.
    const empty = cartSchema.parse(
      (await h.http().get('/v1/cart').set('X-Cart-Token', token).expect(200)).body,
    );
    expect(empty.itemCount).toBe(0);
    // An invalid bearer token is an error, not a silent guest.
    await h.http().get('/v1/cart').set('Authorization', 'Bearer nope').expect(401);
  });
});
