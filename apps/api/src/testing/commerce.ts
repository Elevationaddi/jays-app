import { randomUUID } from 'node:crypto';
import {
  addressSchema,
  cartSchema,
  createOrderResponseSchema,
  merchantProductSchema,
  quoteSchema,
  type Session,
} from '@jays/contracts';
import { sql } from 'kysely';
import {
  adminLogin,
  bearer,
  createBusiness,
  type Harness,
  provisionAdmin,
  signUp,
  uniqueEmail,
} from './harness.js';

/** Fixtures for phase 3 integration tests. All data is fictional. */

let seq = 0;
export const uniqueSku = (prefix = 'SKU') => {
  seq += 1;
  return `${prefix}-${process.pid}-${Date.now() % 1e7}-${seq}`;
};

export async function shopCategoryId(h: Harness): Promise<string> {
  const row = await h.db
    .selectFrom('categories')
    .select('id')
    .where('mode', '=', 'shop')
    .where('slug', '=', 'skincare')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * A shop business that is approved, published and active for shop, made directly in the database
 * (phase 2 tests cover the onboarding flow itself), with delivery zones set through the API.
 */
export async function approvedShop(
  h: Harness,
  zones: { emirate: string; feeFils: number; freeOverFils?: number | null }[] = [
    { emirate: 'DXB', feeFils: 1_500 },
  ],
) {
  const owner = await signUp(h, uniqueEmail('shop-owner'));
  const business = await createBusiness(h, owner, ['shop'], {
    en: `Fictional Shop ${seq}`,
    ar: 'متجر تجريبي',
  });
  const now = new Date();
  await h.db
    .updateTable('businesses')
    .set({
      status: 'approved',
      legal_name: 'Fictional Trading LLC',
      trade_license_number: `TL-${Date.now() % 1e8}`,
      license_authority: 'Fictional Authority',
      license_expiry: '2030-01-01',
      address_emirate_code: 'DXB',
      address_area: 'Area',
      address_street: 'Street',
      address_building: 'Building',
      agreement_version: 'merchant-draft-2026-11',
      agreement_accepted_at: now,
      agreement_accepted_by: owner.user.id,
      submitted_at: now,
      reviewed_at: now,
    })
    .where('id', '=', business.id)
    .execute();
  await h.db
    .updateTable('business_modes')
    .set({ status: 'active', submitted_at: now, reviewed_at: now })
    .where('business_id', '=', business.id)
    .execute();
  const name = JSON.stringify({ en: `Fictional Shop ${seq}`, ar: 'متجر تجريبي' });
  const description = JSON.stringify({ en: 'A fictional test shop.', ar: 'متجر تجريبي للاختبار.' });
  await h.db
    .insertInto('storefronts')
    .values({
      business_id: business.id,
      name,
      description,
      live_name: name,
      live_description: description,
      published_at: now,
    })
    .onConflict((oc) =>
      oc.column('business_id').doUpdateSet({
        live_name: name,
        live_description: description,
        name,
        description,
        published_at: now,
      }),
    )
    .execute();
  await h
    .http()
    .put(`/v1/businesses/${business.id}/delivery-zones`)
    .set('Authorization', bearer(owner))
    .send({ zones: zones.map((z) => ({ ...z, minDays: 1, maxDays: 3 })) })
    .expect(200);
  return { owner, businessId: business.id };
}

/** A ready product image belonging to the business, inserted as if uploaded and checked. */
export async function readyImage(h: Harness, businessId: string, createdBy: string) {
  const row = await h.db
    .insertInto('media')
    .values({
      business_id: businessId,
      purpose: 'product_image',
      object_key: `media/${businessId}/${randomUUID()}.png`,
      content_type: 'image/png',
      declared_size_bytes: 1000,
      size_bytes: 1000,
      width: 800,
      height: 800,
      status: 'ready',
      upload_expires_at: new Date(Date.now() + 600_000),
      uploaded_at: new Date(),
      created_by: createdBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const catalogAdmins = new WeakMap<
  Harness,
  { admin: { email: string; secret: string }; session?: AdminSession; at: number }
>();
type AdminSession = Awaited<ReturnType<typeof adminLogin>>;

/** One catalog admin per harness, signed in once (admin sign-in is rate limited per account). */
export async function catalogAdminSession(h: Harness): Promise<AdminSession> {
  let entry = catalogAdmins.get(h);
  if (!entry) {
    entry = { admin: await provisionAdmin(h, ['catalog']), at: 0 };
    catalogAdmins.set(h, entry);
  }
  // Access tokens last 15 minutes of (test) clock time.
  if (!entry.session || h.clock.now().getTime() - entry.at > 10 * 60_000) {
    entry.session = await adminLogin(h, entry.admin);
    entry.at = h.clock.now().getTime();
  }
  return entry.session;
}

/** Creates, submits and approves a product with the given variants, then stocks it. */
export async function listedProduct(
  h: Harness,
  shop: { owner: Session; businessId: string },
  variants: {
    priceFils: number;
    stock: number;
    taxClass?: 'standard' | 'zero_rated' | 'exempt';
  }[] = [{ priceFils: 10_500, stock: 5 }],
) {
  const auth = bearer(shop.owner);
  const mediaId = await readyImage(h, shop.businessId, shop.owner.user.id);
  const created = merchantProductSchema.parse(
    (
      await h
        .http()
        .post(`/v1/businesses/${shop.businessId}/products`)
        .set('Authorization', auth)
        .send({
          categoryId: await shopCategoryId(h),
          title: { en: 'Fictional Serum', ar: 'سيروم تجريبي' },
          description: { en: 'A fictional serum for tests.', ar: 'سيروم تجريبي للاختبارات.' },
          mediaIds: [mediaId],
          variants: variants.map((v, i) => ({
            sku: uniqueSku(),
            name: { en: `Size ${i + 1}`, ar: `مقاس ${i + 1}` },
            priceFils: v.priceFils,
            taxClass: v.taxClass ?? 'standard',
          })),
        })
        .expect(201)
    ).body,
  );
  await h
    .http()
    .post(`/v1/businesses/${shop.businessId}/products/${created.id}/submit`)
    .set('Authorization', auth)
    .expect(200);
  const admin = await catalogAdminSession(h);
  const submitted = await h.db
    .selectFrom('products')
    .select('version')
    .where('id', '=', created.id)
    .executeTakeFirstOrThrow();
  await h
    .http()
    .post(`/v1/admin/products/${created.id}/actions`)
    .set('Authorization', bearer(admin))
    .send({ action: 'approve', expectedVersion: submitted.version })
    .expect(200);
  for (const [i, v] of variants.entries()) {
    if (v.stock > 0) {
      await h
        .http()
        .post(`/v1/businesses/${shop.businessId}/inventory/adjust`)
        .set('Authorization', auth)
        .set('Idempotency-Key', `stock-${randomUUID()}`)
        .send({ variantId: created.variants[i]?.id, delta: v.stock, reason: 'initial_stock' })
        .expect(200);
    }
  }
  return { productId: created.id, variantIds: created.variants.map((v) => v.id), mediaId };
}

export async function customerWithAddress(h: Harness, emirate = 'DXB') {
  const customer = await signUp(h, uniqueEmail('shopper'));
  const address = addressSchema.parse(
    (
      await h
        .http()
        .post('/v1/me/addresses')
        .set('Authorization', bearer(customer))
        .send({ emirate, area: 'Fictional Area', street: 'Test Street', building: 'Tower 1' })
        .expect(201)
    ).body,
  );
  return { customer, addressId: address.id };
}

export async function addToCart(h: Harness, session: Session, variantId: string, qty: number) {
  const res = await h
    .http()
    .put(`/v1/cart/items/${variantId}`)
    .set('Authorization', bearer(session))
    .send({ qty })
    .expect(200);
  return cartSchema.parse(res.body);
}

export async function quoteFor(h: Harness, session: Session, addressId: string) {
  const res = await h
    .http()
    .post('/v1/checkout/quote')
    .set('Authorization', bearer(session))
    .send({ addressId })
    .expect(201);
  return quoteSchema.parse(res.body);
}

export function placeOrder(
  h: Harness,
  session: Session,
  quoteId: string,
  key = `order-${randomUUID()}`,
) {
  return h
    .http()
    .post('/v1/orders')
    .set('Authorization', bearer(session))
    .set('Idempotency-Key', key)
    .send({ quoteId });
}

export async function placedOrder(h: Harness, session: Session, quoteId: string) {
  const res = await placeOrder(h, session, quoteId).expect(201);
  return createOrderResponseSchema.parse(res.body);
}

export async function stockOf(h: Harness, variantId: string) {
  return h.db
    .selectFrom('variants')
    .select(['stock_on_hand', 'stock_reserved'])
    .where('id', '=', variantId)
    .executeTakeFirstOrThrow();
}

/** Pays through the mock provider's hosted step, then delivers the resulting webhooks. */
export async function pay(
  h: Harness,
  order: { paymentIntentId: string | null; paymentClientSecret: string | null },
  outcome: 'success' | 'fail' | 'timeout' | 'duplicate' = 'success',
) {
  await h
    .http()
    .post(`/v1/mock-psp/intents/${order.paymentIntentId}/confirm`)
    .send({ clientSecret: order.paymentClientSecret, outcome })
    .expect(200);
  return h.deliverWebhooks();
}

/** Runs the shared expiry function as the worker does. */
export async function runExpiry(h: Harness) {
  const { rows } = await sql<{
    n: number;
  }>`SELECT expire_unpaid_orders(${h.clock.now()}, 500) AS n`.execute(h.db);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Ends an order's payment window now. Moving the test clock 15 minutes would also expire the
 * customer's access token, so tests move the deadline instead.
 */
export async function endPaymentWindow(h: Harness, orderId: string) {
  const past = new Date(h.clock.now().getTime() - 1000);
  await h.db
    .updateTable('orders')
    .set({ payment_expires_at: past })
    .where('id', '=', orderId)
    .execute();
  await h.db
    .updateTable('reservations')
    .set({ expires_at: past })
    .where('order_id', '=', orderId)
    .execute();
}
