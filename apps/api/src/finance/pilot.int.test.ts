import {
  adminPilotPromotionSchema,
  businessPromotionSchema,
  pilotDashboardSchema,
  type AdminSession,
} from '@jays/contracts';
import { sql } from 'kysely';
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
import {
  adminLogin,
  bearer,
  createBusiness,
  type Harness,
  provisionAdmin,
  signUp,
  startHarness,
} from '../testing/harness.js';
import { PilotService } from './pilot.service.js';

const DAY = 86_400;
let h: Harness;
let finance: { email: string; secret: string; id: string };
let support: { email: string; secret: string; id: string };
let cached: { session: AdminSession; at: number } | null = null;

beforeAll(async () => {
  h = await startHarness();
  finance = await provisionAdmin(h, ['finance']);
  support = await provisionAdmin(h, ['support']);
});
afterAll(async () => {
  await h.close();
});

/** The finance admin, signed in again whenever the test clock has moved on. */
async function asFinance() {
  if (!cached || h.clock.now().getTime() - cached.at > 5 * 60_000) {
    cached = { session: await adminLogin(h, finance), at: h.clock.now().getTime() };
  }
  return bearer(cached.session);
}

async function shopWithRate(bps: number) {
  const shop = await approvedShop(h);
  await h
    .http()
    .post('/v1/admin/finance/fee-rules')
    .set('Authorization', await asFinance())
    .send({
      mode: 'shop',
      businessId: shop.businessId,
      commissionBps: bps,
      reason: 'Fictional rate',
    })
    .expect(201);
  const product = await listedProduct(h, shop, [{ priceFils: 10_000, stock: 50 }]);
  return { shop, variantId: product.variantIds[0] as string };
}

/** A paid order at the current test-clock time; returns its earning. */
async function paidOrder(businessId: string, variantId: string) {
  const { customer, addressId } = await customerWithAddress(h, 'DXB');
  await addToCart(h, customer, variantId, 1);
  const q = await quoteFor(h, customer, addressId);
  const order = await placedOrder(h, customer, q.quoteId);
  await pay(h, order);
  return h.db
    .selectFrom('merchant_earnings as e')
    .innerJoin('merchant_orders as mo', 'mo.id', 'e.merchant_order_id')
    .select([
      'e.commission_bps',
      'e.commission_fils',
      'e.commission_base_fils',
      'e.pilot_promotion_id',
    ])
    .where('mo.order_id', '=', order.orderId)
    .where('e.business_id', '=', businessId)
    .executeTakeFirstOrThrow();
}

async function enrol(businessId: string, status: number, extra: Record<string, string> = {}) {
  const auth = await asFinance();
  return h
    .http()
    .post('/v1/admin/pilot/promotions')
    .set('Authorization', auth)
    .send({ businessId, founderApproval: 'Founder approval, fictional reference 1', ...extra })
    .expect(status);
}

describe('pilot promotion (ADR-0034)', () => {
  it('waives commission for 30 days, warns before the end, then charges the normal rate', async () => {
    const { shop, variantId } = await shopWithRate(1_000);
    const created = adminPilotPromotionSchema.parse((await enrol(shop.businessId, 201)).body);
    expect(created).toMatchObject({ state: 'active', daysLeft: 30, cancelledAt: null });
    expect(created.business.id).toBe(shop.businessId);

    // Offered once per business.
    expect((await enrol(shop.businessId, 409)).body.error.code).toBe('PROMOTION_EXISTS');

    const during = await paidOrder(shop.businessId, variantId);
    expect(during).toMatchObject({
      commission_bps: 0,
      commission_fils: 0,
      pilot_promotion_id: created.id,
    });
    expect(during.commission_base_fils).toBeGreaterThan(0);

    const view = businessPromotionSchema.parse(
      (
        await h
          .http()
          .get(`/v1/businesses/${shop.businessId}/finance/promotion`)
          .set('Authorization', bearer(shop.owner))
          .expect(200)
      ).body,
    );
    expect(view.promotion?.state).toBe('active');
    expect(view.standardBps.shop).toBe(1_000);

    // 7 days before the end, then 1 day before: one notice each, however often it runs.
    const pilot = h.app.get(PilotService);
    h.clock.advance(23 * DAY + 3600);
    await pilot.queueEndingNotices();
    expect(await pilot.queueEndingNotices()).toBe(0);
    h.clock.advance(6 * DAY);
    await pilot.queueEndingNotices();
    const notices = await h.db
      .selectFrom('outbox')
      .select(['id', 'payload'])
      .where('event_type', '=', 'pilot.promotion_ending')
      .where(sql<string>`payload ->> 'promotionId'`, '=', created.id)
      .execute();
    expect(notices.map((n) => (n.payload as { days: number }).days).sort()).toEqual([1, 7]);
    await h.app.get(NotificationsService).dispatch(
      10,
      notices.map((n) => n.id),
    );
    const inbox = await h.db
      .selectFrom('notifications')
      .select(['title', 'body'])
      .where('user_id', '=', shop.owner.user.id)
      .where('event_type', '=', 'pilot.promotion_ending')
      .execute();
    expect(inbox).toHaveLength(2);
    expect(inbox[0]!.body).toContain('10%');

    // After 30 days the business's normal rate applies again; the earlier sale keeps 0%.
    h.clock.advance(DAY);
    const after = await paidOrder(shop.businessId, variantId);
    expect(after).toMatchObject({ commission_bps: 1_000, pilot_promotion_id: null });

    const dashboard = pilotDashboardSchema.parse(
      (
        await h
          .http()
          .get('/v1/admin/pilot')
          .set('Authorization', await asFinance())
          .expect(200)
      ).body,
    );
    expect(dashboard).toMatchObject({
      emirate: 'AUH',
      durationDays: 30,
      targets: { shop: 30, services: 20 },
      launch: 'founder_approval_required',
    });
    const row = dashboard.promotions.find((p) => p.id === created.id)!;
    expect(row.state).toBe('ended');
    expect(row.sales.count).toBe(1);

    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('target_id', '=', created.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('pilot.promotion_created');
  });

  it('can be ended early without touching earlier sales', async () => {
    const { shop, variantId } = await shopWithRate(1_000);
    const created = adminPilotPromotionSchema.parse((await enrol(shop.businessId, 201)).body);
    const cancel = () =>
      h
        .http()
        .post(`/v1/admin/pilot/promotions/${created.id}/cancel`)
        .send({ reason: 'Fictional: left the pilot' });
    const ended = adminPilotPromotionSchema.parse(
      (
        await cancel()
          .set('Authorization', await asFinance())
          .expect(200)
      ).body,
    );
    expect(ended.state).toBe('cancelled');
    expect(
      (
        await cancel()
          .set('Authorization', await asFinance())
          .expect(409)
      ).body.error.code,
    ).toBe('INVALID_TRANSITION');
    const sale = await paidOrder(shop.businessId, variantId);
    expect(sale).toMatchObject({ commission_bps: 1_000, pilot_promotion_id: null });
  });

  it('refuses unapproved businesses, past start times and admins without finance rights', async () => {
    const owner = await signUp(h);
    const draft = await createBusiness(h, owner);
    expect((await enrol(draft.id, 422)).body.error.code).toBe('BUSINESS_NOT_APPROVED');
    const { shop } = await shopWithRate(1_000);
    const past = new Date(h.clock.now().getTime() - 3_600_000).toISOString();
    expect((await enrol(shop.businessId, 422, { startsAt: past })).body.error.code).toBe(
      'EFFECTIVE_IN_PAST',
    );
    const sup = bearer(await adminLogin(h, support));
    await h
      .http()
      .post('/v1/admin/pilot/promotions')
      .set('Authorization', sup)
      .send({ businessId: shop.businessId, founderApproval: 'Fictional approval' })
      .expect(403);
    // A business member without finance rights cannot read it either.
    const stranger = await signUp(h);
    await h
      .http()
      .get(`/v1/businesses/${shop.businessId}/finance/promotion`)
      .set('Authorization', bearer(stranger))
      .expect(404);
  });
});
