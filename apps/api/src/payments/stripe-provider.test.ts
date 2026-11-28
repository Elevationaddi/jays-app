import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeStripe, stripeEvent } from '../testing/fake-stripe.js';
import { ProviderUnavailableError } from './provider.js';
import {
  STRIPE_API_VERSION,
  StripePaymentProvider,
  StripeRequestError,
} from './stripe-provider.js';

// Mock tests: Stripe's API is faked in process (ADR-0030). Real test-mode calls are in
// stripe.provider.test.ts and run only with a Stripe test key.
const KEY = 'sk_test_FICTIONAL0000000000';
const SECRET = 'whsec_fictional_platform_secret';
const CONNECT_SECRET = 'whsec_fictional_connect_secret';
const now = new Date('2026-12-01T08:00:00Z');

function setup() {
  const fake = new FakeStripe();
  const stripe = new StripePaymentProvider(KEY, [SECRET, CONNECT_SECRET], fake.fetch);
  return { fake, stripe };
}

describe('StripePaymentProvider (mock HTTP)', () => {
  it('refuses live keys', () => {
    expect(() => new StripePaymentProvider('sk_live_FICTIONAL0000000000', [SECRET])).toThrow(
      /non-test keys/,
    );
    expect(() => new StripePaymentProvider('rk_live_FICTIONAL0000000000', [SECRET])).toThrow();
  });

  it('creates a payment intent in AED with the idempotency key and pinned version', async () => {
    const { fake, stripe } = setup();
    const first = await stripe.createIntent({
      amountFils: 12_345,
      currency: 'AED',
      idempotencyKey: 'order-key-1',
      metadata: { orderId: 'order-1' },
    });
    const again = await stripe.createIntent({
      amountFils: 12_345,
      currency: 'AED',
      idempotencyKey: 'order-key-1',
      metadata: { orderId: 'order-1' },
    });
    expect(again).toEqual(first);
    expect(first.intentId).toMatch(/^pi_/);
    const req = fake.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v1/payment_intents');
    expect(req.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(req.headers['stripe-version']).toBe(STRIPE_API_VERSION);
    expect(req.headers['idempotency-key']).toBe('order-key-1');
    expect(Object.fromEntries(req.params)).toEqual({
      amount: '12345',
      currency: 'aed',
      'automatic_payment_methods[enabled]': 'true',
      transfer_group: 'order-1',
      'metadata[orderId]': 'order-1',
    });
  });

  it('refunds with our reference and transfers payouts to the connected account', async () => {
    const { fake, stripe } = setup();
    const { refundId } = await stripe.refund({
      intentId: 'pi_1',
      amountFils: 500,
      idempotencyKey: 'refund-r1',
      reference: 'r1',
    });
    expect(refundId).toMatch(/^re_/);
    expect(fake.requests[0]!.params.get('metadata[reference]')).toBe('r1');

    await expect(
      stripe.createPayout({
        reference: 'p1',
        businessId: 'b1',
        destinationAccount: null,
        amountFils: 1_000,
        currency: 'AED',
        idempotencyKey: 'payout-p1',
      }),
    ).rejects.toThrow(/no connected account/);
    const { payoutId } = await stripe.createPayout({
      reference: 'p1',
      businessId: 'b1',
      destinationAccount: 'acct_fictional1',
      amountFils: 1_000,
      currency: 'AED',
      idempotencyKey: 'payout-p1',
    });
    expect(payoutId).toMatch(/^tr_/);
    const transfer = fake.requests.at(-1)!;
    expect(transfer.path).toBe('/v1/transfers');
    expect(transfer.params.get('destination')).toBe('acct_fictional1');
    expect(transfer.params.get('metadata[reference]')).toBe('p1');
  });

  it('creates an Express account where Stripe handles pricing, and an onboarding link', async () => {
    const { fake, stripe } = setup();
    const account = await stripe.createPayoutAccount({ businessId: 'b1', idempotencyKey: 'k' });
    expect(account).toMatchObject({ detailsSubmitted: false, payoutsEnabled: false });
    const params = Object.fromEntries(fake.requests[0]!.params);
    expect(params).toMatchObject({
      country: 'AE',
      'controller[stripe_dashboard][type]': 'express',
      'controller[fees][payer]': 'account',
      'capabilities[transfers][requested]': 'true',
    });
    const link = await stripe.createOnboardingLink({
      accountId: account.accountId,
      returnUrl: 'https://business.example.test/finance?payoutAccount=return',
      refreshUrl: 'https://business.example.test/finance?payoutAccount=refresh',
    });
    expect(link.url).toMatch(/^https:\/\//);
    fake.accounts.set(account.accountId, { details_submitted: true, payouts_enabled: true });
    expect(await stripe.getPayoutAccount(account.accountId)).toEqual({
      accountId: account.accountId,
      detailsSubmitted: true,
      payoutsEnabled: true,
    });
  });

  it('treats 5xx and 429 as unavailable and 4xx as refused, never echoing the key', async () => {
    const { fake, stripe } = setup();
    fake.failWith = 503;
    await expect(stripe.getPayoutAccount('acct_x')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    fake.failWith = 429;
    await expect(stripe.getPayoutAccount('acct_x')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    fake.failWith = 402;
    const error = await stripe.getPayoutAccount('acct_x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StripeRequestError);
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it('lists every page of intents, refunds and transfers for reconciliation', async () => {
    const { fake, stripe } = setup();
    const created = Math.floor(now.getTime() / 1000);
    fake.lists.set('/v1/payment_intents', [
      [
        {
          id: 'pi_ok',
          status: 'succeeded',
          amount: 1000,
          amount_received: 1000,
          currency: 'aed',
          created,
        },
      ],
      [
        { id: 'pi_open', status: 'requires_payment_method', amount: 500, currency: 'aed', created },
        {
          id: 'pi_declined',
          status: 'requires_payment_method',
          amount: 700,
          currency: 'aed',
          last_payment_error: { code: 'card_declined' },
          created,
        },
      ],
    ]);
    fake.lists.set('/v1/refunds', [
      [
        {
          id: 're_1',
          status: 'succeeded',
          amount: 200,
          currency: 'aed',
          payment_intent: 'pi_ok',
          created,
        },
      ],
    ]);
    fake.lists.set('/v1/transfers', [
      [{ id: 'tr_1', amount: 800, currency: 'aed', reversed: false, created }],
    ]);
    const records = await stripe.listRecords({ from: new Date(now.getTime() - 1000), to: now });
    expect(records.map((r) => [r.kind, r.ref, r.status, r.amountFils])).toEqual([
      ['payment', 'pi_ok', 'succeeded', 1000],
      ['payment', 'pi_declined', 'failed', 700],
      ['refund', 're_1', 'succeeded', 200],
      ['payout', 'tr_1', 'paid', 800],
    ]);
    const second = fake.requests.filter((r) => r.path === '/v1/payment_intents')[1]!;
    expect(second.params.get('starting_after')).toBe('pi_ok');
  });
});

describe('Stripe webhooks (mock HTTP)', () => {
  const { stripe } = setup();
  const verify = (d: { body: string; headers: Record<string, string> }, at = now) =>
    stripe.verifyWebhook(Buffer.from(d.body), d.headers['stripe-signature'], at);

  it('accepts the platform and Connect signing secrets and nothing else', () => {
    const obj = { id: 'pi_1', amount_received: 1000, currency: 'aed' };
    expect(verify(stripeEvent(SECRET, 'payment_intent.succeeded', obj, now))).toMatchObject({
      type: 'payment_intent.succeeded',
      intentId: 'pi_1',
      amountFils: 1000,
      currency: 'AED',
    });
    expect(
      verify(stripeEvent(CONNECT_SECRET, 'payment_intent.succeeded', obj, now)),
    ).not.toBeNull();
    expect(
      verify(stripeEvent('whsec_wrong_secret_value', 'payment_intent.succeeded', obj, now)),
    ).toBeNull();
    // Older than five minutes.
    expect(
      verify(
        stripeEvent(SECRET, 'payment_intent.succeeded', obj, now),
        new Date(now.getTime() + 301_000),
      ),
    ).toBeNull();
    // Tampered body.
    const d = stripeEvent(SECRET, 'payment_intent.succeeded', obj, now);
    expect(verify({ ...d, body: d.body.replace('1000', '9000') })).toBeNull();
  });

  it('refuses future timestamps, malformed headers and signed bodies that are not events', () => {
    const obj = { id: 'pi_1', amount_received: 1000, currency: 'aed' };
    // Signed six minutes in the future (clock skew beyond the tolerance, or a pre-made replay).
    const future = stripeEvent(
      SECRET,
      'payment_intent.succeeded',
      obj,
      new Date(now.getTime() + 360_000),
    );
    expect(verify(future)).toBeNull();
    const d = stripeEvent(SECRET, 'payment_intent.succeeded', obj, now);
    const t = Math.floor(now.getTime() / 1000);
    for (const header of [
      '',
      'garbage',
      `t=${t}`,
      `v1=${d.headers['stripe-signature']!.split('v1=')[1]}`,
      `t=not-a-number,v1=${'a'.repeat(64)}`,
      `t=${t},v1=${'z'.repeat(64)}`,
      `t=${t},v0=${d.headers['stripe-signature']!.split('v1=')[1]}`,
    ]) {
      expect(verify({ ...d, headers: { 'stripe-signature': header } })).toBeNull();
    }
    expect(stripe.verifyWebhook(Buffer.from(d.body), undefined, now)).toBeNull();
    // Correctly signed bytes that are not JSON, or JSON that is not an event, are refused.
    const signed = (body: string) => {
      const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
      return { body, headers: { 'stripe-signature': `t=${t},v1=${v1}` } };
    };
    expect(verify(signed('{not json'))).toBeNull();
    expect(verify(signed('[]'))).toBeNull();
    expect(verify(signed(JSON.stringify({ id: 'evt_1', type: 'x', livemode: false })))).toBeNull();
  });

  it('refuses live-mode events even when correctly signed', () => {
    const d = stripeEvent(SECRET, 'payment_intent.succeeded', { id: 'pi_1' }, now, {
      livemode: true,
    });
    expect(verify(d)).toBeNull();
  });

  it('maps declines, cancellations, refunds, transfers and account updates', () => {
    const ev = (type: string, obj: Record<string, unknown>) =>
      verify(stripeEvent(SECRET, type, obj, now));
    expect(ev('payment_intent.payment_failed', { id: 'pi_1', amount: 1000 })?.type).toBe(
      'payment_intent.attempt_failed',
    );
    expect(ev('payment_intent.canceled', { id: 'pi_1', amount: 1000 })?.type).toBe(
      'payment_intent.payment_failed',
    );
    expect(
      ev('refund.updated', {
        id: 're_1',
        status: 'succeeded',
        amount: 200,
        payment_intent: 'pi_1',
        metadata: { reference: 'ref-1' },
      }),
    ).toMatchObject({
      type: 'refund.succeeded',
      refundId: 're_1',
      reference: 'ref-1',
      intentId: 'pi_1',
    });
    expect(ev('refund.created', { id: 're_2', status: 'pending', amount: 1 })?.type).toBe(
      'refund.pending',
    );
    expect(
      ev('refund.failed', {
        id: 're_3',
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      }),
    ).toMatchObject({
      type: 'refund.failed',
      failureCode: 'expired_or_canceled_card',
    });
    expect(
      ev('transfer.created', {
        id: 'tr_1',
        amount: 800,
        currency: 'aed',
        metadata: { reference: 'p1' },
      }),
    ).toMatchObject({ type: 'payout.paid', payoutId: 'tr_1', reference: 'p1', amountFils: 800 });
    expect(ev('transfer.reversed', { id: 'tr_1', amount: 800 })?.type).toBe('payout.reversed');
    expect(
      ev('account.updated', { id: 'acct_1', details_submitted: true, payouts_enabled: true })
        ?.account,
    ).toEqual({ accountId: 'acct_1', detailsSubmitted: true, payoutsEnabled: true });
  });
});
