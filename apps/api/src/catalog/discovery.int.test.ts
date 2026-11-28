import { randomUUID } from 'node:crypto';
import {
  merchantVariantSchema,
  orderSchema,
  pageSchema,
  productFacetsSchema,
  publicProductListItemSchema,
  publicProductSchema,
  stockAlertListSchema,
  wishlistSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../aftercare/notifications.service.js';
import {
  addToCart,
  approvedShop,
  customerWithAddress,
  listedProduct,
  pay,
  placedOrder,
  quoteFor,
} from '../testing/commerce.js';
import { bearer, type Harness, signUp, startHarness, uniqueEmail } from '../testing/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const page = pageSchema(publicProductListItemSchema);
type Shop = Awaited<ReturnType<typeof approvedShop>>;

async function products(query: string) {
  return page.parse((await h.http().get(`/v1/products?${query}`).expect(200)).body);
}

function patchVariant(shop: Shop, variantId: string, body: Record<string, unknown>) {
  return h
    .http()
    .patch(`/v1/businesses/${shop.businessId}/variants/${variantId}`)
    .set('Authorization', bearer(shop.owner))
    .send(body);
}

async function buy(variantId: string, qty: number) {
  const { customer, addressId } = await customerWithAddress(h);
  await addToCart(h, customer, variantId, qty);
  const quote = await quoteFor(h, customer, addressId);
  const order = await placedOrder(h, customer, quote.quoteId);
  await pay(h, order);
  const view = orderSchema.parse(
    (
      await h
        .http()
        .get(`/v1/orders/${order.orderId}`)
        .set('Authorization', bearer(customer))
        .expect(200)
    ).body,
  );
  return { customer, view };
}

describe('sale prices (compare-at)', () => {
  it('shows a genuine was-price, filters and sorts by saving, and ends the sale on a price rise', async () => {
    const shop = await approvedShop(h);
    const plain = await listedProduct(h, shop, [{ priceFils: 8_000, stock: 3 }]);
    const sale = await listedProduct(h, shop, [
      { priceFils: 7_500, stock: 3 },
      { priceFils: 12_000, stock: 3 },
    ]);
    const [cheap, dear] = sale.variantIds as [string, string];

    const bad = await patchVariant(shop, cheap, { compareAtFils: 7_500 }).expect(400);
    expect(bad.body.error.fieldErrors.compareAtFils).toBeDefined();
    const set = merchantVariantSchema.parse(
      (await patchVariant(shop, cheap, { compareAtFils: 10_000 }).expect(200)).body,
    );
    expect(set.compareAtFils).toBe(10_000);
    await patchVariant(shop, dear, { compareAtFils: 24_000 }).expect(200);

    const list = await products(`store=${shop.businessId}&sort=discount`);
    expect(list.items.map((p) => p.id)).toEqual([sale.productId, plain.productId]);
    const first = list.items[0]!;
    expect(first.compareAtFils).toBe(10_000);
    expect(first.discountPercent).toBe(50); // the larger saving across variants
    expect(list.items[1]!.discountPercent).toBeNull();

    const onSale = await products(`store=${shop.businessId}&onSale=true`);
    expect(onSale.items.map((p) => p.id)).toEqual([sale.productId]);

    const detail = publicProductSchema.parse(
      (await h.http().get(`/v1/products/${sale.productId}`).expect(200)).body,
    );
    expect(detail.variants.map((v) => v.discountPercent)).toEqual([25, 50]);

    // Raising the price to the was-price ends the sale instead of failing.
    const raised = merchantVariantSchema.parse(
      (await patchVariant(shop, cheap, { priceFils: 10_000 }).expect(200)).body,
    );
    expect(raised.compareAtFils).toBeNull();

    // Creating a variant with a was-price below its price is refused.
    const refused = await h
      .http()
      .post(`/v1/businesses/${shop.businessId}/products/${plain.productId}/variants`)
      .set('Authorization', bearer(shop.owner))
      .send({
        sku: `CMP-${randomUUID().slice(0, 8)}`,
        name: { en: 'Big', ar: 'كبير' },
        priceFils: 9_000,
        compareAtFils: 8_000,
      });
    expect(refused.status).toBe(400);
  });
});

describe('ratings, popularity, facets and related products', () => {
  it('ranks by real reviews and paid units, and counts filters', async () => {
    const shop = await approvedShop(h);
    const a = await listedProduct(h, shop, [{ priceFils: 5_000, stock: 10 }]);
    const b = await listedProduct(h, shop, [{ priceFils: 9_000, stock: 10 }]);
    const c = await listedProduct(h, shop, [{ priceFils: 15_000, stock: 0 }]);

    // b sells three units, a sells one.
    const sold = await buy(b.variantIds[0]!, 3);
    const soldA = await buy(a.variantIds[0]!, 1);
    const popular = await products(`store=${shop.businessId}&sort=popular`);
    expect(popular.items.map((p) => p.id)).toEqual([b.productId, a.productId, c.productId]);

    // Ratings come from published reviews only; a hidden one is ignored.
    const review = (
      userId: string,
      productId: string,
      itemId: string,
      rating: number,
      status: 'published' | 'hidden',
    ) =>
      h.db
        .insertInto('reviews')
        .values({
          user_id: userId,
          business_id: shop.businessId,
          target_type: 'product',
          order_item_id: itemId,
          product_id: productId,
          rating,
          status,
          hidden_reason: status === 'hidden' ? 'Fictional moderation reason' : null,
        })
        .execute();
    await review(
      soldA.customer.user.id,
      a.productId,
      soldA.view.merchants[0]!.items[0]!.id,
      5,
      'published',
    );
    await review(
      sold.customer.user.id,
      b.productId,
      sold.view.merchants[0]!.items[0]!.id,
      2,
      'hidden',
    );
    const rated = await products(`store=${shop.businessId}&sort=rating`);
    expect(rated.items[0]!.id).toBe(a.productId);
    expect(rated.items[0]!.rating).toEqual({ average: 5, count: 1 });
    expect(rated.items.find((p) => p.id === b.productId)!.rating).toBeNull();
    expect((await products(`store=${shop.businessId}&minRating=4`)).items.map((p) => p.id)).toEqual(
      [a.productId],
    );

    // Paging through a sort with a cursor returns every product once.
    const p1 = await products(`store=${shop.businessId}&sort=popular&limit=2`);
    const p2 = await products(
      `store=${shop.businessId}&sort=popular&limit=2&cursor=${p1.nextCursor}`,
    );
    expect([...p1.items, ...p2.items].map((p) => p.id)).toEqual([
      b.productId,
      a.productId,
      c.productId,
    ]);
    expect(p2.nextCursor).toBeNull();

    const facets = productFacetsSchema.parse(
      (await h.http().get(`/v1/products/facets?store=${shop.businessId}`).expect(200)).body,
    );
    expect(facets).toMatchObject({
      total: 3,
      priceMinFils: 5_000,
      priceMaxFils: 15_000,
      inStockCount: 2,
      onSaleCount: 0,
    });

    const related = await h.http().get(`/v1/products/${a.productId}/related`).expect(200);
    const items = page.shape.items.parse(related.body.items);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(8);
    expect(items.map((p) => p.id)).not.toContain(a.productId);
    expect(new Set(items.map((p) => p.categoryId))).toEqual(new Set([rated.items[0]!.categoryId]));
    await h.http().get(`/v1/products/${randomUUID()}/related`).expect(404);
  });
});

describe('wishlist', () => {
  it('saves visible products only, is idempotent, and keeps products that left sale', async () => {
    const shop = await approvedShop(h);
    const p = await listedProduct(h, shop);
    const me = await signUp(h, uniqueEmail('wisher'));
    const auth = bearer(me);
    await h.http().get('/v1/me/wishlist').expect(401);
    await h.http().put(`/v1/me/wishlist/${randomUUID()}`).set('Authorization', auth).expect(404);
    await h.http().put(`/v1/me/wishlist/${p.productId}`).set('Authorization', auth).expect(200);
    const twice = wishlistSchema.parse(
      (await h.http().put(`/v1/me/wishlist/${p.productId}`).set('Authorization', auth).expect(200))
        .body,
    );
    expect(twice.items).toHaveLength(1);
    expect(twice.items[0]!.product?.id).toBe(p.productId);

    // Another customer's list is separate.
    const other = await signUp(h, uniqueEmail('other'));
    const empty = wishlistSchema.parse(
      (await h.http().get('/v1/me/wishlist').set('Authorization', bearer(other)).expect(200)).body,
    );
    expect(empty.items).toEqual([]);

    // Archiving the product hides it but keeps the saved entry.
    await h
      .http()
      .post(`/v1/businesses/${shop.businessId}/products/${p.productId}/archive`)
      .set('Authorization', bearer(shop.owner))
      .expect(200);
    const hidden = wishlistSchema.parse(
      (await h.http().get('/v1/me/wishlist').set('Authorization', auth).expect(200)).body,
    );
    expect(hidden.items[0]).toMatchObject({ productId: p.productId, product: null });
    const removed = wishlistSchema.parse(
      (
        await h
          .http()
          .delete(`/v1/me/wishlist/${p.productId}`)
          .set('Authorization', auth)
          .expect(200)
      ).body,
    );
    expect(removed.items).toEqual([]);
  });
});

describe('back-in-stock alerts', () => {
  it('notifies once when a sold-out option returns, through any stock path', async () => {
    const shop = await approvedShop(h);
    const p = await listedProduct(h, shop, [
      { priceFils: 6_000, stock: 0 },
      { priceFils: 7_000, stock: 2 },
    ]);
    const [soldOut, available] = p.variantIds as [string, string];
    const me = await signUp(h, uniqueEmail('watcher'));
    const auth = bearer(me);

    const inStock = await h
      .http()
      .post(`/v1/me/stock-alerts/${available}`)
      .set('Authorization', auth)
      .expect(409);
    expect(inStock.body.error.code).toBe('IN_STOCK');
    await h
      .http()
      .post(`/v1/me/stock-alerts/${randomUUID()}`)
      .set('Authorization', auth)
      .expect(404);
    await h.http().post(`/v1/me/stock-alerts/${soldOut}`).set('Authorization', auth).expect(200);
    const open = stockAlertListSchema.parse(
      (await h.http().post(`/v1/me/stock-alerts/${soldOut}`).set('Authorization', auth).expect(200))
        .body,
    );
    expect(open.items).toHaveLength(1);
    expect(open.items[0]).toMatchObject({ variantId: soldOut, productId: p.productId });

    // The merchant restocks: the alert closes and one event is queued.
    await h
      .http()
      .post(`/v1/businesses/${shop.businessId}/inventory/adjust`)
      .set('Authorization', bearer(shop.owner))
      .set('Idempotency-Key', `restock-${randomUUID()}`)
      .send({ variantId: soldOut, delta: 4, reason: 'restock' })
      .expect(200);
    const events = await h.db
      .selectFrom('outbox')
      .select(['id', 'payload'])
      .where('event_type', '=', 'product.back_in_stock')
      .execute();
    const mine = events.filter((e) => (e.payload as { userId: string }).userId === me.user.id);
    expect(mine).toHaveLength(1);
    const after = stockAlertListSchema.parse(
      (await h.http().get('/v1/me/stock-alerts').set('Authorization', auth).expect(200)).body,
    );
    expect(after.items).toEqual([]);

    // The dispatcher writes the in-app notification in the customer's language.
    await h.app.get(NotificationsService).dispatch(10, [mine[0]!.id]);
    const note = await h.db
      .selectFrom('notifications')
      .select(['title', 'link'])
      .where('user_id', '=', me.user.id)
      .where('event_type', '=', 'product.back_in_stock')
      .executeTakeFirstOrThrow();
    expect(note.title).toBe('Back in stock: Fictional Serum');
    expect(note.link).toBe(`/products/${p.productId}`);

    // More stock while already available does not notify again.
    await h
      .http()
      .post(`/v1/businesses/${shop.businessId}/inventory/adjust`)
      .set('Authorization', bearer(shop.owner))
      .set('Idempotency-Key', `restock-${randomUUID()}`)
      .send({ variantId: soldOut, delta: 1, reason: 'restock' })
      .expect(200);
    const again = await h.db
      .selectFrom('outbox')
      .select('payload')
      .where('event_type', '=', 'product.back_in_stock')
      .execute();
    expect(
      again.filter((e) => (e.payload as { userId: string }).userId === me.user.id),
    ).toHaveLength(1);
  });
});
