import { randomUUID } from 'node:crypto';
import {
  adminProductDetailSchema,
  inventoryItemSchema,
  merchantProductSchema,
  publicProductListItemSchema,
  publicProductSchema,
  pageSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approvedShop,
  catalogAdminSession,
  listedProduct,
  readyImage,
  shopCategoryId,
  uniqueSku,
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
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const productPage = pageSchema(publicProductListItemSchema);

async function draft(shop: Awaited<ReturnType<typeof approvedShop>>, withImage = true) {
  const mediaIds = withImage ? [await readyImage(h, shop.businessId, shop.owner.user.id)] : [];
  const res = await h
    .http()
    .post(`/v1/businesses/${shop.businessId}/products`)
    .set('Authorization', bearer(shop.owner))
    .send({
      categoryId: await shopCategoryId(h),
      title: { en: 'Draft Balm', ar: 'بلسم مسودة' },
      description: { en: 'A fictional draft balm.', ar: 'بلسم تجريبي في المسودة.' },
      mediaIds,
      variants: [{ sku: uniqueSku('D'), name: { en: '30 ml', ar: '٣٠ مل' }, priceFils: 4_500 }],
    })
    .expect(201);
  return merchantProductSchema.parse(res.body);
}

async function publicIds(store: string) {
  return productPage
    .parse((await h.http().get(`/v1/products?store=${store}&limit=100`).expect(200)).body)
    .items.map((p) => p.id);
}

describe('listing approval and visibility (T02 for products)', () => {
  it('keeps drafts and submissions private until a catalog admin approves', async () => {
    const shop = await approvedShop(h);
    const incomplete = await draft(shop, false);
    const refused = await h
      .http()
      .post(`/v1/businesses/${shop.businessId}/products/${incomplete.id}/submit`)
      .set('Authorization', bearer(shop.owner))
      .expect(422);
    expect(refused.body.error.code).toBe('PRODUCT_INCOMPLETE');
    expect(refused.body.error.fieldErrors.checklist).toEqual(['image']);

    const product = await draft(shop);
    await h.http().get(`/v1/products/${product.id}`).expect(404);
    const submitted = merchantProductSchema.parse(
      (
        await h
          .http()
          .post(`/v1/businesses/${shop.businessId}/products/${product.id}/submit`)
          .set('Authorization', bearer(shop.owner))
          .expect(200)
      ).body,
    );
    expect(submitted.status).toBe('submitted');
    await h.http().get(`/v1/products/${product.id}`).expect(404);
    expect(await publicIds(shop.businessId)).not.toContain(product.id);
    // No self approval: merchants have no admin route, and editing is locked during review.
    await h
      .http()
      .patch(`/v1/businesses/${shop.businessId}/products/${product.id}`)
      .set('Authorization', bearer(shop.owner))
      .send({ title: { en: 'Sneaky', ar: 'تعديل' } })
      .expect(409);

    // Support can view the queue but not decide.
    const support = await adminLogin(h, await provisionAdmin(h, ['support']));
    await h.http().get('/v1/admin/products').set('Authorization', bearer(support)).expect(200);
    await h
      .http()
      .post(`/v1/admin/products/${product.id}/actions`)
      .set('Authorization', bearer(support))
      .send({ action: 'approve', expectedVersion: submitted.version })
      .expect(403);

    const admin = await catalogAdminSession(h);
    await h
      .http()
      .post(`/v1/admin/products/${product.id}/actions`)
      .set('Authorization', bearer(admin))
      .send({ action: 'approve', expectedVersion: submitted.version - 1 })
      .expect(409);
    const approved = adminProductDetailSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/products/${product.id}/actions`)
          .set('Authorization', bearer(admin))
          .send({ action: 'approve', expectedVersion: submitted.version })
          .expect(200)
      ).body,
    );
    expect(approved.status).toBe('active');
    expect(approved.history.map((e) => e.action)).toContain('product.approved');
    const pub = publicProductSchema.parse(
      (await h.http().get(`/v1/products/${product.id}`).expect(200)).body,
    );
    expect(pub.title.en).toBe('Draft Balm');
    expect(pub.inStock).toBe(false); // listed but no stock yet: shown as sold out
    expect(pub.delivery.map((z) => z.emirate)).toEqual(['DXB']);
    expect(await publicIds(shop.businessId)).toContain(product.id);
    const inStock = productPage.parse(
      (
        await h
          .http()
          .get(`/v1/products?store=${shop.businessId}&availability=in_stock`)
          .expect(200)
      ).body,
    );
    expect(inStock.items.map((p) => p.id)).not.toContain(product.id);
  });

  it('serves live images only for visible products', async () => {
    const shop = await approvedShop(h);
    const listed = await listedProduct(h, shop);
    const res = await h.http().get(`/v1/media/${listed.mediaId}`).expect(302);
    expect(res.headers['location']).toContain('/storage/');
    const privateImage = await readyImage(h, shop.businessId, shop.owner.user.id);
    await h.http().get(`/v1/media/${privateImage}`).expect(404);
  });

  it('keeps the live copy public while edits wait for review, and applies them on approval', async () => {
    const shop = await approvedShop(h);
    const { productId } = await listedProduct(h, shop);
    const edited = merchantProductSchema.parse(
      (
        await h
          .http()
          .patch(`/v1/businesses/${shop.businessId}/products/${productId}`)
          .set('Authorization', bearer(shop.owner))
          .send({ title: { en: 'Renamed Serum', ar: 'سيروم جديد' } })
          .expect(200)
      ).body,
    );
    expect(edited.changesPending).toBe(true);
    expect(edited.live?.title.en).toBe('Fictional Serum');
    let pub = publicProductSchema.parse(
      (await h.http().get(`/v1/products/${productId}`).expect(200)).body,
    );
    expect(pub.title.en).toBe('Fictional Serum');

    const admin = await catalogAdminSession(h);
    const rejected = adminProductDetailSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/products/${productId}/actions`)
          .set('Authorization', bearer(admin))
          .send({
            action: 'reject',
            reason: 'Title makes a claim.',
            expectedVersion: edited.version,
          })
          .expect(200)
      ).body,
    );
    expect(rejected.status).toBe('active');
    expect(rejected.changesPending).toBe(false);
    expect(rejected.reviewReason).toBe('Title makes a claim.');

    const again = merchantProductSchema.parse(
      (
        await h
          .http()
          .patch(`/v1/businesses/${shop.businessId}/products/${productId}`)
          .set('Authorization', bearer(shop.owner))
          .send({ title: { en: 'Hydrating Serum', ar: 'سيروم مرطب' } })
          .expect(200)
      ).body,
    );
    await h
      .http()
      .post(`/v1/admin/products/${productId}/actions`)
      .set('Authorization', bearer(admin))
      .send({ action: 'approve', expectedVersion: again.version })
      .expect(200);
    pub = publicProductSchema.parse(
      (await h.http().get(`/v1/products/${productId}`).expect(200)).body,
    );
    expect(pub.title.en).toBe('Hydrating Serum');
  });

  it('hides listings at once on takedown or business suspension, and restores them', async () => {
    const shop = await approvedShop(h);
    const { productId } = await listedProduct(h, shop);
    const compliance = await adminLogin(h, await provisionAdmin(h, ['compliance']));
    const detail = adminProductDetailSchema.parse(
      (
        await h
          .http()
          .get(`/v1/admin/products/${productId}`)
          .set('Authorization', bearer(compliance))
          .expect(200)
      ).body,
    );
    await h
      .http()
      .post(`/v1/admin/products/${productId}/actions`)
      .set('Authorization', bearer(compliance))
      .send({ action: 'suspend', expectedVersion: detail.version })
      .expect(400); // reason required
    const suspended = adminProductDetailSchema.parse(
      (
        await h
          .http()
          .post(`/v1/admin/products/${productId}/actions`)
          .set('Authorization', bearer(compliance))
          .send({
            action: 'suspend',
            reason: 'Unverified claims.',
            expectedVersion: detail.version,
          })
          .expect(200)
      ).body,
    );
    await h.http().get(`/v1/products/${productId}`).expect(404);
    await h
      .http()
      .post(`/v1/admin/products/${productId}/actions`)
      .set('Authorization', bearer(compliance))
      .send({ action: 'reinstate', reason: 'Claims removed.', expectedVersion: suspended.version })
      .expect(200);
    await h.http().get(`/v1/products/${productId}`).expect(200);

    await h.db
      .updateTable('businesses')
      .set({ status: 'suspended', suspended_at: new Date(), suspension_reason: 'Test' })
      .where('id', '=', shop.businessId)
      .execute();
    await h.http().get(`/v1/products/${productId}`).expect(404);
    expect(await publicIds(shop.businessId)).toEqual([]);
  });
});

describe('merchant catalog rules', () => {
  it('requires SKUs unique per business but not across businesses', async () => {
    const a = await approvedShop(h);
    const b = await approvedShop(h);
    const sku = uniqueSku('U');
    const body = (s: string) => ({
      categoryId: '',
      title: { en: 'Unique Mist', ar: 'رذاذ' },
      description: { en: 'A fictional face mist.', ar: 'رذاذ تجريبي للوجه.' },
      variants: [{ sku: s, name: { en: 'One', ar: 'واحد' }, priceFils: 2_000 }],
    });
    const categoryId = await shopCategoryId(h);
    await h
      .http()
      .post(`/v1/businesses/${a.businessId}/products`)
      .set('Authorization', bearer(a.owner))
      .send({ ...body(sku), categoryId })
      .expect(201);
    const dup = await h
      .http()
      .post(`/v1/businesses/${a.businessId}/products`)
      .set('Authorization', bearer(a.owner))
      .send({ ...body(sku), categoryId })
      .expect(409);
    expect(dup.body.error.code).toBe('SKU_TAKEN');
    await h
      .http()
      .post(`/v1/businesses/${b.businessId}/products`)
      .set('Authorization', bearer(b.owner))
      .send({ ...body(sku), categoryId })
      .expect(201);
    // Non-positive prices and services categories are refused.
    await h
      .http()
      .post(`/v1/businesses/${a.businessId}/products`)
      .set('Authorization', bearer(a.owner))
      .send({
        ...body(uniqueSku()),
        categoryId,
        variants: [{ sku: uniqueSku(), name: { en: 'x', ar: 'س' }, priceFils: 0 }],
      })
      .expect(400);
    const services = await h.db
      .selectFrom('categories')
      .select('id')
      .where('mode', '=', 'services')
      .executeTakeFirstOrThrow();
    await h
      .http()
      .post(`/v1/businesses/${a.businessId}/products`)
      .set('Authorization', bearer(a.owner))
      .send({ ...body(uniqueSku()), categoryId: services.id })
      .expect(422);
  });

  it("refuses another business's images", async () => {
    const a = await approvedShop(h);
    const b = await approvedShop(h);
    const foreign = await readyImage(h, b.businessId, b.owner.user.id);
    const res = await h
      .http()
      .post(`/v1/businesses/${a.businessId}/products`)
      .set('Authorization', bearer(a.owner))
      .send({
        categoryId: await shopCategoryId(h),
        title: { en: 'Borrowed', ar: 'مستعار' },
        description: { en: 'Uses a foreign image.', ar: 'يستخدم صورة متجر آخر.' },
        mediaIds: [foreign],
        variants: [{ sku: uniqueSku(), name: { en: 'One', ar: 'واحد' }, priceFils: 1_000 }],
      })
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_MEDIA');
  });
});

describe('inventory (transactional, tenant-scoped)', () => {
  it('adjusts idempotently, never below reserved stock, and records movements', async () => {
    const shop = await approvedShop(h);
    const { variantIds } = await listedProduct(h, shop, [{ priceFils: 3_000, stock: 0 }]);
    const variantId = variantIds[0] as string;
    const auth = bearer(shop.owner);
    const key = `adj-${randomUUID()}`;
    const send = (k: string, delta: number, reason = 'restock') =>
      h
        .http()
        .post(`/v1/businesses/${shop.businessId}/inventory/adjust`)
        .set('Authorization', auth)
        .set('Idempotency-Key', k)
        .send({ variantId, delta, reason });
    const first = inventoryItemSchema.parse((await send(key, 10).expect(200)).body);
    const replay = inventoryItemSchema.parse((await send(key, 10).expect(200)).body);
    expect(first.stockOnHand).toBe(10);
    expect(replay).toEqual(first);
    expect((await send(key, 11).expect(409)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      (
        await h
          .http()
          .post(`/v1/businesses/${shop.businessId}/inventory/adjust`)
          .set('Authorization', auth)
          .send({ variantId, delta: 1, reason: 'restock' })
          .expect(400)
      ).body.error.code,
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await h.db
      .updateTable('variants')
      .set({ stock_reserved: 4 })
      .where('id', '=', variantId)
      .execute();
    const short = await send(`adj-${randomUUID()}`, -7, 'correction').expect(409);
    expect(short.body.error.code).toBe('INSUFFICIENT_STOCK');
    await send(`adj-${randomUUID()}`, 3, 'damaged').expect(422);
    const after = inventoryItemSchema.parse(
      (await send(`adj-${randomUUID()}`, -6, 'correction').expect(200)).body,
    );
    expect(after).toMatchObject({
      stockOnHand: 4,
      stockReserved: 4,
      stockAvailable: 0,
      lowStock: true,
    });
    await h.db
      .updateTable('variants')
      .set({ stock_reserved: 0 })
      .where('id', '=', variantId)
      .execute();
    // The database refuses negative stock even if code were wrong.
    await expect(
      h.db.updateTable('variants').set({ stock_on_hand: -1 }).where('id', '=', variantId).execute(),
    ).rejects.toMatchObject({ code: '23514' });
    const movements = await h
      .http()
      .get(`/v1/businesses/${shop.businessId}/inventory/${variantId}/movements`)
      .set('Authorization', auth)
      .expect(200);
    expect(movements.body.items.map((m: { delta: number }) => m.delta)).toEqual([-6, 10]);
    await expect(
      h.db.deleteFrom('stock_movements').where('variant_id', '=', variantId).execute(),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('isolates businesses and enforces staff permissions (T03)', async () => {
    const a = await approvedShop(h);
    const b = await approvedShop(h);
    const { productId, variantIds } = await listedProduct(h, a);
    const outsider = bearer(b.owner);
    await h
      .http()
      .get(`/v1/businesses/${a.businessId}/products/${productId}`)
      .set('Authorization', outsider)
      .expect(404);
    await h
      .http()
      .get(`/v1/businesses/${a.businessId}/inventory`)
      .set('Authorization', outsider)
      .expect(404);
    // B's own routes cannot reach A's variant either.
    await h
      .http()
      .post(`/v1/businesses/${b.businessId}/inventory/adjust`)
      .set('Authorization', outsider)
      .set('Idempotency-Key', `x-${randomUUID()}`)
      .send({ variantId: variantIds[0], delta: 5, reason: 'restock' })
      .expect(404);
    await h
      .http()
      .patch(`/v1/businesses/${b.businessId}/variants/${variantIds[0]}`)
      .set('Authorization', outsider)
      .send({ priceFils: 1 })
      .expect(404);

    // A fulfillment member can adjust stock but cannot manage the catalog.
    const staff = await signUp(h, uniqueEmail('staff'));
    await h
      .http()
      .post(`/v1/businesses/${a.businessId}/members`)
      .set('Authorization', bearer(a.owner))
      .send({ identifier: staff.email, permissions: ['fulfillment'] })
      .expect(201);
    const invite = await h.db
      .selectFrom('memberships')
      .select('id')
      .where('business_id', '=', a.businessId)
      .where('user_id', '=', staff.user.id)
      .executeTakeFirstOrThrow();
    await h
      .http()
      .post(`/v1/me/memberships/${invite.id}/accept`)
      .set('Authorization', bearer(staff))
      .expect(200);
    await h
      .http()
      .get(`/v1/businesses/${a.businessId}/products`)
      .set('Authorization', bearer(staff))
      .expect(403);
    await h
      .http()
      .get(`/v1/businesses/${a.businessId}/inventory`)
      .set('Authorization', bearer(staff))
      .expect(200);
    await h
      .http()
      .post(`/v1/businesses/${a.businessId}/inventory/adjust`)
      .set('Authorization', bearer(staff))
      .set('Idempotency-Key', `s-${randomUUID()}`)
      .send({ variantId: variantIds[0], delta: 2, reason: 'restock' })
      .expect(200);
  });
});
