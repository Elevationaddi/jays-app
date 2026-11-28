import { randomUUID } from 'node:crypto';
import {
  categorySchema,
  deliveryZoneListSchema,
  merchantOrderSchema,
  orderSchema,
  publicProductSchema,
  quoteSchema,
  returnPolicySchema,
  returnSchema,
  type Session,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addToCart,
  approvedShop,
  catalogAdminSession,
  customerWithAddress,
  listedProduct,
  pay,
  placedOrder,
  quoteFor,
} from '../testing/commerce.js';
import { bearer, type Harness, startHarness } from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

type Shop = Awaited<ReturnType<typeof approvedShop>>;

function zones(shop: Shop, body: object) {
  return h
    .http()
    .put(`/v1/businesses/${shop.businessId}/delivery-zones`)
    .set('Authorization', bearer(shop.owner))
    .send(body);
}

function quote(customer: Session, addressId: string, deliveryMethods?: Record<string, string>) {
  return h
    .http()
    .post('/v1/checkout/quote')
    .set('Authorization', bearer(customer))
    .send({ addressId, ...(deliveryMethods ? { deliveryMethods } : {}) });
}

function act(shop: Shop, moId: string) {
  return h
    .http()
    .post(`/v1/businesses/${shop.businessId}/orders/${moId}/fulfillment`)
    .set('Authorization', bearer(shop.owner));
}

async function getOrder(customer: Session, orderId: string) {
  return orderSchema.parse(
    (await h.http().get(`/v1/orders/${orderId}`).set('Authorization', bearer(customer)).expect(200))
      .body,
  );
}

describe('delivery methods (ADR-0029)', () => {
  it('offers standard and express, uses the choice and keeps it on the order', async () => {
    const shop = await approvedShop(h);
    const saved = deliveryZoneListSchema.parse(
      (
        await zones(shop, {
          zones: [
            { emirate: 'DXB', feeFils: 1_500, minDays: 2, maxDays: 4 },
            { emirate: 'DXB', method: 'express', feeFils: 3_000, minDays: 0, maxDays: 1 },
          ],
        }).expect(200)
      ).body,
    );
    expect(saved.items.map((z) => z.method).sort()).toEqual(['express', 'standard']);
    // One zone per emirate and method.
    await zones(shop, {
      zones: [
        { emirate: 'DXB', feeFils: 1_500, minDays: 2, maxDays: 4 },
        { emirate: 'DXB', feeFils: 1_000, minDays: 2, maxDays: 4 },
      ],
    }).expect(400);

    const product = await listedProduct(h, shop, [{ priceFils: 10_000, stock: 5 }]);
    const pub = publicProductSchema.parse(
      (await h.http().get(`/v1/products/${product.productId}`).expect(200)).body,
    );
    expect(pub.delivery.map((d) => d.method).sort()).toEqual(['express', 'standard']);

    const { customer, addressId } = await customerWithAddress(h, 'DXB');
    await addToCart(h, customer, product.variantIds[0] as string, 1);
    const standard = quoteSchema.parse((await quote(customer, addressId).expect(201)).body);
    const group = standard.groups[0]!;
    expect(group.delivery).toMatchObject({ method: 'standard', feeFils: 1_500 });
    expect(group.deliveryOptions).toEqual([
      { method: 'standard', feeFils: 1_500, minDays: 2, maxDays: 4 },
      { method: 'express', feeFils: 3_000, minDays: 0, maxDays: 1 },
    ]);

    const express = quoteSchema.parse(
      (await quote(customer, addressId, { [shop.businessId]: 'express' }).expect(201)).body,
    );
    expect(express.groups[0]!.delivery).toMatchObject({ method: 'express', feeFils: 3_000 });
    expect(express.totalFils).toBe(standard.totalFils + 1_500);

    const order = await placedOrder(h, customer, express.quoteId);
    await pay(h, order);
    const view = await getOrder(customer, order.orderId);
    expect(view.merchants[0]!.delivery).toMatchObject({ method: 'express', feeFils: 3_000 });
  });

  it('refuses a method the seller does not offer, and a quote whose method was withdrawn', async () => {
    const shop = await approvedShop(h);
    const product = await listedProduct(h, shop, [{ priceFils: 10_000, stock: 5 }]);
    const { customer, addressId } = await customerWithAddress(h, 'DXB');
    await addToCart(h, customer, product.variantIds[0] as string, 1);
    const refused = await quote(customer, addressId, { [shop.businessId]: 'express' }).expect(422);
    expect(refused.body.error.code).toBe('DELIVERY_METHOD_UNAVAILABLE');

    await zones(shop, {
      zones: [
        { emirate: 'DXB', feeFils: 1_500, minDays: 2, maxDays: 4 },
        { emirate: 'DXB', method: 'express', feeFils: 3_000, minDays: 0, maxDays: 1 },
      ],
    }).expect(200);
    const express = quoteSchema.parse(
      (await quote(customer, addressId, { [shop.businessId]: 'express' }).expect(201)).body,
    );
    await zones(shop, {
      zones: [{ emirate: 'DXB', feeFils: 1_500, minDays: 2, maxDays: 4 }],
    }).expect(200);
    const stale = await h
      .http()
      .post('/v1/orders')
      .set('Authorization', bearer(customer))
      .set('Idempotency-Key', `order-${randomUUID()}`)
      .send({ quoteId: express.quoteId })
      .expect(409);
    expect(stale.body.error.code).toBe('QUOTE_STALE');
  });
});

describe('return policies (ADR-0029)', () => {
  it('copies the window onto the order and refuses non-returnable items unless faulty', async () => {
    const shop = await approvedShop(h);
    const auth = bearer(shop.owner);
    // Never shorter than the platform's 14 days.
    await h
      .http()
      .put(`/v1/businesses/${shop.businessId}/return-policy`)
      .set('Authorization', auth)
      .send({ windowDays: 7 })
      .expect(400);
    const policy = returnPolicySchema.parse(
      (
        await h
          .http()
          .put(`/v1/businesses/${shop.businessId}/return-policy`)
          .set('Authorization', auth)
          .send({
            windowDays: 30,
            note: { en: 'Unopened items only.', ar: 'المنتجات غير المفتوحة فقط.' },
          })
          .expect(200)
      ).body,
    );
    expect(policy).toEqual({
      windowDays: 30,
      note: { en: 'Unopened items only.', ar: 'المنتجات غير المفتوحة فقط.' },
    });

    // A fresh category, marked non-returnable by an admin, so other files are unaffected.
    const admin = bearer(await catalogAdminSession(h));
    const category = categorySchema.parse(
      (
        await h
          .http()
          .post('/v1/admin/categories')
          .set('Authorization', admin)
          .send({
            mode: 'shop',
            slug: `hygiene-${randomUUID().slice(0, 8)}`,
            name: { en: 'Fictional hygiene', ar: 'نظافة تجريبية' },
          })
          .expect(201)
      ).body,
    );
    const updated = categorySchema.parse(
      (
        await h
          .http()
          .patch(`/v1/admin/categories/${category.id}`)
          .set('Authorization', admin)
          .send({ returnable: false })
          .expect(200)
      ).body,
    );
    expect(updated.returnable).toBe(false);

    const normal = await listedProduct(h, shop, [{ priceFils: 10_000, stock: 5 }]);
    const hygiene = await listedProduct(h, shop, [{ priceFils: 5_000, stock: 5 }]);
    await h.db
      .updateTable('products')
      .set({ live_category_id: category.id, category_id: category.id })
      .where('id', '=', hygiene.productId)
      .execute();
    const pub = publicProductSchema.parse(
      (await h.http().get(`/v1/products/${hygiene.productId}`).expect(200)).body,
    );
    expect(pub.returns).toMatchObject({ windowDays: 30, returnable: false });

    const { customer, addressId } = await customerWithAddress(h, 'DXB');
    await addToCart(h, customer, normal.variantIds[0] as string, 1);
    await addToCart(h, customer, hygiene.variantIds[0] as string, 1);
    const q = await quoteFor(h, customer, addressId);
    const order = await placedOrder(h, customer, q.quoteId);
    await pay(h, order);

    // A later change never affects this order.
    await h
      .http()
      .put(`/v1/businesses/${shop.businessId}/return-policy`)
      .set('Authorization', auth)
      .send({ windowDays: 14 })
      .expect(200);

    let view = await getOrder(customer, order.orderId);
    const mo = view.merchants[0]!;
    expect(mo.returnPolicy).toEqual({ windowDays: 30, returnUntil: null });
    await act(shop, mo.id)
      .send({ action: 'ship', expectedStatus: 'paid', carrier: 'Fictional', trackingNumber: 'F1' })
      .expect(201);
    await act(shop, mo.id).send({ action: 'deliver', expectedStatus: 'shipped' }).expect(201);
    // 20 days later: past 14, inside the 30 the order was placed under.
    await h.db
      .updateTable('merchant_orders')
      .set({ delivered_at: new Date(h.clock.now().getTime() - 20 * 86_400_000) })
      .where('id', '=', mo.id)
      .execute();
    view = await getOrder(customer, order.orderId);
    expect(view.merchants[0]!.canReturn).toBe(true);
    const items = view.merchants[0]!.items;
    const hygieneItem = items.find((i) => i.productId === hygiene.productId)!;
    const normalItem = items.find((i) => i.productId === normal.productId)!;
    expect(hygieneItem.returnable).toBe(false);
    expect(normalItem.returnable).toBe(true);

    const ret = (body: Record<string, unknown>) =>
      h
        .http()
        .post(`/v1/orders/${order.orderId}/returns`)
        .set('Authorization', bearer(customer))
        .send({ merchantOrderId: mo.id, reason: 'Fictional reason', ...body });
    const refused = await ret({ items: [{ orderItemId: hygieneItem.id, qty: 1 }] }).expect(422);
    expect(refused.body.error.code).toBe('ITEM_NOT_RETURNABLE');
    const faulty = returnSchema.parse(
      (await ret({ items: [{ orderItemId: hygieneItem.id, qty: 1 }], faulty: true }).expect(201))
        .body,
    );
    expect(faulty.faulty).toBe(true);
  });
});

describe('delivery partner (ADR-0029)', () => {
  it('books a shipment with the configured partner, which supplies the tracking', async () => {
    const shop = await approvedShop(h);
    const product = await listedProduct(h, shop, [{ priceFils: 10_000, stock: 5 }]);
    const { customer, addressId } = await customerWithAddress(h, 'DXB');
    await addToCart(h, customer, product.variantIds[0] as string, 1);
    const q = await quoteFor(h, customer, addressId);
    const order = await placedOrder(h, customer, q.quoteId);
    await pay(h, order);
    const moId = (await getOrder(customer, order.orderId)).merchants[0]!.id;
    const detail = merchantOrderSchema.parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${shop.businessId}/orders/${moId}`)
          .set('Authorization', bearer(shop.owner))
          .expect(200)
      ).body,
    );
    expect(detail.partnerAvailable).toBe(true);
    const shipped = merchantOrderSchema.parse(
      (
        await act(shop, moId)
          .send({ action: 'ship', expectedStatus: 'paid', usePartner: true })
          .expect(201)
      ).body,
    );
    expect(shipped.fulfillment.partner).toBe('mock');
    expect(shipped.fulfillment.trackingNumber).toMatch(/^MOCK-[0-9A-F]{10}$/);
    expect(shipped.fulfillment.trackingUrl).toMatch(/^https:\/\//);
    const customerView = await getOrder(customer, order.orderId);
    expect(customerView.merchants[0]!.fulfillment.trackingUrl).toBe(
      shipped.fulfillment.trackingUrl,
    );
  });
});
