import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StripePaymentProvider } from './stripe-provider.js';

/**
 * Real-provider tests against Stripe's **test mode** (ADR-0030). They run only with
 * `pnpm --filter @jays/api test:providers` and a test key in STRIPE_TEST_SECRET_KEY, never in the
 * normal unit or CI runs, and no result is claimed without one. Nothing here can move real money:
 * the adapter refuses live keys.
 */
const key = process.env['STRIPE_TEST_SECRET_KEY'];

describe.skipIf(!key)('Stripe test mode (real provider)', () => {
  const stripe = () => new StripePaymentProvider(key as string, ['whsec_unused_in_this_test']);

  it('creates, confirms with a test card and partly refunds a payment intent', async () => {
    const intent = await stripe().createIntent({
      amountFils: 1_000,
      currency: 'AED',
      idempotencyKey: `provider-test-${randomUUID()}`,
      metadata: { orderId: `provider-test-${randomUUID()}` },
    });
    expect(intent.intentId).toMatch(/^pi_/);
    // Stripe's documented test payment method; the client normally confirms with Stripe.js.
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${intent.intentId}/confirm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key as string}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          payment_method: 'pm_card_visa',
          return_url: 'https://example.test/return',
        }).toString(),
      },
    );
    expect(res.status).toBe(200);
    const { refundId } = await stripe().refund({
      intentId: intent.intentId,
      amountFils: 400,
      idempotencyKey: `provider-test-${randomUUID()}`,
      reference: randomUUID(),
    });
    expect(refundId).toMatch(/^re_/);
  });

  it('creates a connected account and an onboarding link', async () => {
    const account = await stripe().createPayoutAccount({
      businessId: randomUUID(),
      idempotencyKey: `provider-test-${randomUUID()}`,
    });
    expect(account.accountId).toMatch(/^acct_/);
    const link = await stripe().createOnboardingLink({
      accountId: account.accountId,
      returnUrl: 'https://example.test/finance?payoutAccount=return',
      refreshUrl: 'https://example.test/finance?payoutAccount=refresh',
    });
    expect(link.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
  });
});
