import {
  feeRuleSchema,
  pageSchema,
  taxDocumentSchema,
  taxDocumentSummarySchema,
  vatReportSchema,
} from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvedVenue, confirmedBooking, dubaiDay } from '../testing/booking.js';
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
} from '../testing/harness.js';

let h: Harness;
let finance: string;
beforeAll(async () => {
  h = await startHarness();
  finance = bearer(await adminLogin(h, await provisionAdmin(h, ['finance'])));
});
afterAll(async () => {
  await h.close();
});

function rule(body: Record<string, unknown>) {
  return h
    .http()
    .post('/v1/admin/finance/fee-rules')
    .set('Authorization', finance)
    .send({ reason: 'Fictional test rate', ...body });
}

/** A fresh subcategory under skincare, so category rules here touch no other test. */
async function testCategory() {
  const parent = await h.db
    .selectFrom('categories')
    .select('id')
    .where('mode', '=', 'shop')
    .where('slug', '=', 'skincare')
    .executeTakeFirstOrThrow();
  const child = await h.db
    .insertInto('categories')
    .values({
      mode: 'shop',
      parent_id: parent.id,
      slug: `tax-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: JSON.stringify({ en: 'Fictional', ar: 'تجريبي' }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return child.id;
}

/** One paid order from one shop: two of a 105.00 item (VAT included) plus 15.00 delivery. */
async function paidOrder(shop: Awaited<ReturnType<typeof approvedShop>>, categoryId?: string) {
  const product = await listedProduct(h, shop, [{ priceFils: 10_500, stock: 5 }]);
  if (categoryId) {
    await h.db
      .updateTable('products')
      .set({ live_category_id: categoryId })
      .where('id', '=', product.productId)
      .execute();
  }
  const { customer, addressId } = await customerWithAddress(h);
  await addToCart(h, customer, product.variantIds[0] as string, 2);
  const quote = await quoteFor(h, customer, addressId);
  const order = await placedOrder(h, customer, quote.quoteId);
  await pay(h, order);
  const mo = await h.db
    .selectFrom('merchant_orders')
    .select(['id', 'tax_fils', 'total_fils'])
    .where('order_id', '=', order.orderId)
    .executeTakeFirstOrThrow();
  const payment = await h.db
    .selectFrom('payments')
    .select('id')
    .where('order_id', '=', order.orderId)
    .executeTakeFirstOrThrow();
  return { customer, quote, order, mo, paymentId: payment.id };
}

describe('commission rules (D2)', () => {
  it('applies a category rule to its subcategories, and a business rule for that category above it', async () => {
    const parentId = await testCategory();
    const child = await h.db
      .insertInto('categories')
      .values({
        mode: 'shop',
        parent_id: parentId,
        slug: `tax-child-${Date.now()}`,
        name: JSON.stringify({ en: 'Fictional child', ar: 'فرعي' }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const shopA = await approvedShop(h, [{ emirate: 'DXB', feeFils: 1_500 }]);
    const shopB = await approvedShop(h, [{ emirate: 'DXB', feeFils: 1_500 }]);
    const created = await rule({ mode: 'shop', categoryId: parentId, commissionBps: 800 }).expect(
      201,
    );
    expect(
      feeRuleSchema
        .array()
        .parse(created.body)
        .find((r) => r.category?.id === parentId),
    ).toMatchObject({ business: null, commissionBps: 800, inForce: true });
    await rule({
      mode: 'shop',
      businessId: shopB.businessId,
      categoryId: parentId,
      commissionBps: 300,
    }).expect(201);
    // A category of the other mode is refused.
    const hair = await h.db
      .selectFrom('categories')
      .select('id')
      .where('mode', '=', 'services')
      .where('slug', '=', 'hair')
      .executeTakeFirstOrThrow();
    const bad = await rule({ mode: 'shop', categoryId: hair.id, commissionBps: 100 }).expect(422);
    expect(bad.body.error.code).toBe('CATEGORY_MODE_MISMATCH');

    const a = await paidOrder(shopA, child.id);
    const b = await paidOrder(shopB, child.id);
    const earning = (moId: string) =>
      h.db
        .selectFrom('merchant_earnings')
        .select(['commission_base_fils', 'commission_bps', 'commission_fils', 'commission_detail'])
        .where('merchant_order_id', '=', moId)
        .executeTakeFirstOrThrow();
    // Goods 21,000 include 1,000 VAT; delivery carries no commission.
    expect(await earning(a.mo.id)).toMatchObject({
      commission_base_fils: 20_000,
      commission_bps: 800,
      commission_fils: 1_600,
    });
    const eb = await earning(b.mo.id);
    expect(eb).toMatchObject({
      commission_base_fils: 20_000,
      commission_bps: 300,
      commission_fils: 600,
    });
    expect(eb.commission_detail).toEqual([
      expect.objectContaining({ categoryId: child.id, commissionBps: 300, baseFils: 20_000 }),
    ]);
  });
});

describe('VAT registration (D4)', () => {
  it('charges no VAT for a seller that is not VAT registered, with the same price', async () => {
    const shop = await approvedShop(h, [{ emirate: 'DXB', feeFils: 1_500 }]);
    const off = await h
      .http()
      .put(`/v1/admin/finance/businesses/${shop.businessId}/tax`)
      .set('Authorization', finance)
      .send({ taxRegistered: false, reason: 'Below the registration threshold' })
      .expect(200);
    expect(off.body).toMatchObject({ taxRegistered: false, taxId: null });
    await h
      .http()
      .put(`/v1/admin/finance/businesses/${shop.businessId}/tax`)
      .set('Authorization', finance)
      .send({ taxRegistered: true, reason: 'No TRN given' })
      .expect(400);
    const { quote, mo } = await paidOrder(shop);
    expect(quote.totalFils).toBe(22_500);
    expect(quote.taxFils).toBe(0);
    expect(mo.tax_fils).toBe(0);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', shop.businessId)
      .where('action', '=', 'finance.business_tax_changed')
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('refuses VAT on commission until the platform has a VAT number', async () => {
    const res = await h
      .http()
      .post('/v1/admin/finance/settings')
      .set('Authorization', finance)
      .send({ key: 'platform_vat_registered', value: 1, reason: 'Fictional registration' })
      .expect(422);
    expect(res.body.error.code).toBe('PLATFORM_TRN_MISSING');
  });
});

describe('tax documents (D3, D4)', () => {
  it('issues the seller’s invoice and JAYS’s commission invoice on payment, and credit notes on refund', async () => {
    const shop = await approvedShop(h, [{ emirate: 'DXB', feeFils: 1_500 }]);
    await rule({ mode: 'shop', businessId: shop.businessId, commissionBps: 1_000 }).expect(201);
    const { customer, order, mo, paymentId } = await paidOrder(shop);

    // The customer sees the seller's invoice for the order, and nothing else.
    const mine = pageSchema(taxDocumentSummarySchema).parse(
      (
        await h
          .http()
          .get(`/v1/me/documents?orderId=${order.orderId}`)
          .set('Authorization', bearer(customer))
          .expect(200)
      ).body,
    );
    expect(mine.items).toHaveLength(1);
    const invoiceId = mine.items[0]!.id;
    const invoice = taxDocumentSchema.parse(
      (
        await h
          .http()
          .get(`/v1/me/documents/${invoiceId}`)
          .set('Authorization', bearer(customer))
          .expect(200)
      ).body,
    );
    expect(invoice).toMatchObject({
      kind: 'customer_invoice',
      issuer: 'business',
      taxDocument: true,
      rulesApproved: false,
      totalFils: 22_500,
      vatFils: mo.tax_fils,
      netFils: 22_500 - mo.tax_fils,
      seller: { trn: '100000000000003' },
      credits: null,
    });
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice.lines.map((l) => l.totalFils)).toEqual([21_000, 1_500]);
    expect(invoice.lines.reduce((t, l) => t + l.vatFils, 0)).toBe(mo.tax_fils);

    // Another customer cannot open it.
    const other = await signUp(h);
    await h
      .http()
      .get(`/v1/me/documents/${invoiceId}`)
      .set('Authorization', bearer(other))
      .expect(404);

    // The business sees its invoice and the commission invoice addressed to it.
    const biz = pageSchema(taxDocumentSummarySchema).parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${shop.businessId}/finance/documents`)
          .set('Authorization', bearer(shop.owner))
          .expect(200)
      ).body,
    );
    const commission = biz.items.find((d) => d.kind === 'commission_invoice');
    expect(commission).toMatchObject({
      issuer: 'platform',
      netFils: 2_000,
      vatFils: 0,
      totalFils: 2_000,
      taxDocument: false,
    });
    expect(
      (
        await h
          .http()
          .get(`/v1/businesses/${shop.businessId}/finance/documents/${commission!.id}`)
          .set('Authorization', bearer(shop.owner))
          .expect(200)
      ).body.number,
    ).toMatch(/^JCI-/);

    // A partial refund: a credit note with VAT in proportion, and commission given back.
    await h
      .http()
      .post('/v1/admin/finance/refund-requests')
      .set('Authorization', finance)
      .send({ paymentId, merchantOrderId: mo.id, amountFils: 11_250, reason: 'One item damaged' })
      .expect(201);
    await h.deliverWebhooks();
    const after = pageSchema(taxDocumentSummarySchema).parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${shop.businessId}/finance/documents?limit=10`)
          .set('Authorization', bearer(shop.owner))
          .expect(200)
      ).body,
    );
    const credit = after.items.find((d) => d.kind === 'customer_credit_note');
    expect(credit).toMatchObject({ totalFils: 11_250, vatFils: Math.round(mo.tax_fils / 2) });
    const commissionCredit = after.items.find((d) => d.kind === 'commission_credit_note');
    expect(commissionCredit).toMatchObject({ totalFils: 1_000, vatFils: 0 });
    const creditDoc = taxDocumentSchema.parse(
      (
        await h
          .http()
          .get(`/v1/me/documents/${credit!.id}`)
          .set('Authorization', bearer(customer))
          .expect(200)
      ).body,
    );
    expect(creditDoc.credits).toEqual({ id: invoiceId, number: invoice.number });

    // The VAT report has the seller's sales and credits for the day.
    const day = new Date(h.clock.now().getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
    const report = vatReportSchema.parse(
      (
        await h
          .http()
          .get(`/v1/admin/finance/vat-report?from=${day}&to=${day}`)
          .set('Authorization', finance)
          .expect(200)
      ).body,
    );
    expect(report.rulesApproved).toBe(false);
    expect(report.platform.registered).toBe(false);
    const row = report.businesses.find((b) => b.business.id === shop.businessId);
    expect(row).toMatchObject({
      taxRegistered: true,
      invoiced: { vatFils: mo.tax_fils, totalFils: 22_500, documents: 1 },
      credited: { totalFils: 11_250, documents: 1 },
      netVatFils: mo.tax_fils - Math.round(mo.tax_fils / 2),
    });
    await h
      .http()
      .get(`/v1/admin/finance/vat-report?from=${day}&to=2020-01-01`)
      .set('Authorization', finance)
      .expect(400);

    // Documents never change once issued.
    await expect(
      h.db
        .updateTable('tax_documents')
        .set({ total_fils: 1 })
        .where('id', '=', invoiceId)
        .execute(),
    ).rejects.toThrow();
  });

  it('issues an invoice for a paid appointment', async () => {
    const v = await approvedVenue(h);
    const user = await signUp(h);
    const booking = await confirmedBooking(h, user, {
      branchId: v.branchId,
      serviceId: v.serviceId,
      startAt: dubaiDay(h, 3).at('15:00'),
    });
    const docs = pageSchema(taxDocumentSummarySchema).parse(
      (
        await h
          .http()
          .get(`/v1/me/documents?bookingId=${booking.id}`)
          .set('Authorization', bearer(user))
          .expect(200)
      ).body,
    );
    expect(docs.items).toEqual([
      expect.objectContaining({ kind: 'customer_invoice', bookingId: booking.id, vatFils: 500 }),
    ]);
  });
});
