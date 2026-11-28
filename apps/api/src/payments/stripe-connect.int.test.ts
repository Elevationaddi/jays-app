import { orderSchema, paymentConfigSchema, payoutAccountSchema } from '@jays/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addToCart,
  approvedShop,
  customerWithAddress,
  listedProduct,
  placedOrder,
  quoteFor,
} from '../testing/commerce.js';
import { FakeStripe, stripeEvent } from '../testing/fake-stripe.js';
import { bearer, type Harness, startHarness } from '../testing/harness.js';
import { StripePaymentProvider } from './stripe-provider.js';

// Mock test (ADR-0030): the API runs with the real Stripe adapter, but Stripe's HTTP API is
// faked in process and webhooks are signed locally with Stripe's documented scheme.
const CONNECT_SECRET = 'whsec_fictional_connect_secret_value';
const fake = new FakeStripe();
let h: Harness;
let platformSecret: string;

beforeAll(async () => {
  h = await startHarness({
    env: { PSP_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET },
    paymentProvider: (env) => {
      platformSecret = env.PSP_WEBHOOK_SECRET;
      return new StripePaymentProvider(
        'sk_test_FICTIONAL0000000000',
        [env.PSP_WEBHOOK_SECRET, CONNECT_SECRET],
        fake.fetch,
      );
    },
  });
});
afterAll(async () => {
  await h.close();
});

function deliver(d: { body: string; headers: Record<string, string> }) {
  return h.http().post('/v1/webhooks/payments').set(d.headers).send(d.body);
}

describe('Stripe Connect in test mode (ADR-0030)', () => {
  it('reports the provider and that payments are in test mode', async () => {
    const config = paymentConfigSchema.parse(
      (await h.http().get('/v1/payments/config').expect(200)).body,
    );
    expect(config).toEqual({ provider: 'stripe', testMode: true, publishableKey: null });
  });

  it('pays an order only on a Stripe-signed success; a declined attempt changes nothing', async () => {
    const shop = await approvedShop(h);
    const product = await listedProduct(h, shop, [{ priceFils: 10_000, stock: 5 }]);
    const { customer, addressId } = await customerWithAddress(h, 'DXB');
    await addToCart(h, customer, product.variantIds[0] as string, 1);
    const q = await quoteFor(h, customer, addressId);
    const order = await placedOrder(h, customer, q.quoteId);
    expect(order.paymentIntentId).toMatch(/^pi_/);
    const created = fake.requests.find((r) => r.path === '/v1/payment_intents')!;
    expect(created.params.get('amount')).toBe(String(order.totalFils));
    expect(created.params.get('transfer_group')).toBe(order.orderId);

    const status = async () =>
      orderSchema.parse(
        (
          await h
            .http()
            .get(`/v1/orders/${order.orderId}`)
            .set('Authorization', bearer(customer))
            .expect(200)
        ).body,
      ).status;
    const now = h.clock.now();
    const intent = { id: order.paymentIntentId, amount: order.totalFils, currency: 'aed' };
    await deliver(
      stripeEvent(
        platformSecret,
        'payment_intent.payment_failed',
        { ...intent, last_payment_error: { code: 'card_declined' } },
        now,
      ),
    ).expect(200);
    expect(await status()).toBe('pending_payment');

    // The mock provider's header is not read when Stripe is configured.
    const forged = stripeEvent(
      platformSecret,
      'payment_intent.succeeded',
      { ...intent, amount_received: order.totalFils },
      now,
    );
    await h
      .http()
      .post('/v1/webhooks/payments')
      .set({
        'content-type': 'application/json',
        'x-psp-signature': forged.headers['stripe-signature'] as string,
      })
      .send(forged.body)
      .expect(401);
    expect(await status()).toBe('pending_payment');

    await deliver(forged).expect(200);
    expect(await status()).toBe('paid');
    // Stripe retries deliveries; a replay is a no-op.
    const replay = await deliver(forged).expect(200);
    expect(replay.body).toEqual({ received: true, duplicate: true });
  });

  it('onboards a payout account through Stripe and enables it from the Connect webhook', async () => {
    const shop = await approvedShop(h);
    const base = `/v1/businesses/${shop.businessId}/finance/payout-account`;
    const auth = bearer(shop.owner);
    const before = payoutAccountSchema.parse(
      (await h.http().get(base).set('Authorization', auth).expect(200)).body,
    );
    expect(before).toMatchObject({ provider: 'stripe', required: true, status: 'none' });

    const link = await h
      .http()
      .post(`${base}/onboarding-link`)
      .set('Authorization', auth)
      .expect(200);
    expect(link.body.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
    const accountReq = fake.requests.filter((r) => r.path === '/v1/accounts').at(-1)!;
    expect(accountReq.params.get('metadata[businessId]')).toBe(shop.businessId);
    // A second link reuses the same account.
    await h.http().post(`${base}/onboarding-link`).set('Authorization', auth).expect(200);
    expect(
      fake.requests.filter(
        (r) =>
          r.path === '/v1/accounts' && r.params.get('metadata[businessId]') === shop.businessId,
      ),
    ).toHaveLength(1);

    const row = await h.db
      .selectFrom('businesses')
      .select(['psp_account_id'])
      .where('id', '=', shop.businessId)
      .executeTakeFirstOrThrow();
    const accountId = row.psp_account_id as string;
    const pending = payoutAccountSchema.parse(
      (await h.http().get(base).set('Authorization', auth).expect(200)).body,
    );
    expect(pending.status).toBe('pending');

    await deliver(
      stripeEvent(
        CONNECT_SECRET,
        'account.updated',
        { id: accountId, details_submitted: true, payouts_enabled: true },
        h.clock.now(),
        { account: accountId },
      ),
    ).expect(200);
    const enabled = payoutAccountSchema.parse(
      (await h.http().get(base).set('Authorization', auth).expect(200)).body,
    );
    expect(enabled).toMatchObject({ status: 'enabled', payoutsEnabled: true });

    // Returning from onboarding re-reads Stripe, which is the source of truth.
    fake.accounts.set(accountId, { details_submitted: true, payouts_enabled: false });
    const refreshed = payoutAccountSchema.parse(
      (await h.http().post(`${base}/refresh`).set('Authorization', auth).expect(200)).body,
    );
    expect(refreshed.status).toBe('pending');
  });

  it('starts onboarding only once the business is approved', async () => {
    const shop = await approvedShop(h);
    await h.db
      .updateTable('businesses')
      .set({ status: 'suspended', suspended_at: new Date(), suspension_reason: 'Fictional test' })
      .where('id', '=', shop.businessId)
      .execute();
    const res = await h
      .http()
      .post(`/v1/businesses/${shop.businessId}/finance/payout-account/onboarding-link`)
      .set('Authorization', bearer(shop.owner))
      .expect(409);
    expect(res.body.error.code).toBe('BUSINESS_NOT_APPROVED');
  });
});
