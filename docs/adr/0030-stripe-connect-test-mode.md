# ADR-0030: Stripe Connect in test mode

Status: Accepted (technical design, test mode only). The funds flow is **proposed** until Stripe confirms which Connect configuration it supports for a UAE marketplace, and a lawyer confirms it fits the disclosed-agent model (D3). Live payments are not approved and cannot start (section 6).

Date: 2026-11-28

## Context

D5 chose Stripe Connect in sandbox. ADR-0024 keeps it to per-transaction fees, needing the founder's approval, and asks for the configuration where Stripe handles pricing for connected accounts, so there is no monthly fee per merchant. Until now only the mock provider existed. The rest of the payment design (ADR-0013, ADR-0015) is provider-neutral:

- signed webhooks are the only thing that marks money as moved;
- events are recorded once per event id;
- refunds and payouts are called outside database transactions and are idempotent;
- daily reconciliation compares the provider's records with the ledger.

## Decision

1. **Adapter.** `StripePaymentProvider` implements the existing `PaymentProvider` interface.
   - It calls Stripe's REST API with `fetch`, so no SDK dependency is added.
   - The API version is pinned to `2024-06-20`.
   - Every write carries an idempotency key.
   - A 429 or 5xx response, or a timeout, counts as "provider unavailable". Any other 4xx counts as a refusal. Error messages never contain the key.
2. **Funds flow (proposed).** Charges and transfers are separate:
   - A cart can hold several merchants, so the customer pays one PaymentIntent for the whole order (or booking), grouped by `transfer_group`.
   - The money stays in the platform's Stripe balance until it is eligible. ADR-0021 sets eligibility at 7 days after delivery or completion.
   - A weekly payout is a Stripe **transfer** to the business's connected account. Stripe then pays the business's bank on the account's own schedule. A transfer counts as `payout.paid`.
   - This uses Stripe's own balances, not an escrow built by JAYS (D6).
   - With this flow JAYS is the settlement merchant on the card statement. That may not fit D3, where businesses are the sellers. The alternative is a destination charge `on_behalf_of` each business, which needs one payment per merchant at checkout. This question is for Stripe and the lawyer.
3. **Connected payout accounts.**
   - The business owner (`onboarding.manage`) opens Stripe's hosted onboarding from Finance in the business portal. This is only possible once the business is approved.
   - The adapter creates an account with Stripe's controller properties: Express dashboard, the account pays Stripe's fees, Stripe covers losses, and the transfers capability. This is the "Stripe handles pricing" option in the setup guide.
   - JAYS stores only the account id and two flags: details submitted and payouts enabled. Identity and bank details stay with Stripe.
   - The flags are updated two ways: from the `account.updated` webhook (signed with the Connect endpoint's own secret), and by re-reading Stripe when the owner returns from onboarding.
   - Creating and updating an account is audited.
4. **Payouts need an account.** With Stripe, a payout run skips a business without a ready account, with the reason `no_payout_account`. Its earnings stay eligible for the next run. The mock pays any business, as before.
5. **Events.**
   - `payment_intent.succeeded` pays the order or booking.
   - A declined attempt (`payment_intent.payment_failed`) changes nothing: at Stripe the customer can retry on the same intent, and the hold expires if they give up. Only `payment_intent.canceled` ends the payment.
   - Refund events become `refund.succeeded` or `refund.failed` from the refund's status. Pending refunds change nothing.
   - Refunds and transfers carry our own id in `metadata.reference`. A webhook that arrives before we stored Stripe's id still matches the right record. The mock now does the same.
   - `transfer.reversed` is recorded but not applied. Only finance reverses a payout, and reconciliation flags the changed transfer.
   - The webhook route reads only the configured provider's signature header, so a mock signature never authenticates under Stripe.
6. **Live payments are impossible without a code change.**
   - The environment schema and the adapter both refuse a key that is not a test key (`sk_test_`, `rk_test_`, `pk_test_`), in every environment.
   - Webhooks with `livemode: true` are refused even when correctly signed.
   - `GET /v1/payments/config` always reports `testMode: true`.
7. **Reconciliation.**
   - `listRecords` reads payment intents, refunds and transfers created in the period, page by page.
   - A payment counts as failed only when an attempt was declined. An intent nobody tried is not a record.
8. **Tests are labelled.**
   - **Mock tests** use `FakeStripe`, an in-process fake of the endpoints above, and events signed with Stripe's documented scheme. They cover the unit tests (`stripe-provider.test.ts`) and an integration test (`stripe-connect.int.test.ts`) that runs the whole API with the Stripe adapter.
   - **Real-provider tests** (`*.provider.test.ts`) run only with `pnpm --filter @jays/api test:providers` and a `STRIPE_TEST_SECRET_KEY`. They are not part of CI. They have not been run, because no Stripe test key is available, and no result is claimed.

## Not done yet

- **The customer payment step with Stripe.** The API returns the PaymentIntent's client secret and the publishable key, but the apps still use the mock's payment step.
  - The web needs Stripe.js with the Payment Element.
  - The native app needs `@stripe/stripe-react-native` and a development build.
  - Both are free and open source.
  - Apple Pay, Google Pay and 3-D Secure come from these components.
  - This needs a Stripe test key to build and check, so it is listed in the final report.
- **Disputes.** Stripe's `charge.dispute.*` events are not mapped yet. Admins record disputes by hand (ADR-0015).
- **Cancelling an intent at Stripe when a hold expires.** A late success is already refunded in full (ADR-0013). Cancelling would stop the late payment instead of refunding it.

## Consequences

- Founder actions: create the Stripe account in test mode, turn on Connect, and set the keys and both webhook secrets in Vercel. The steps are in docs/FOUNDER_SETUP_GUIDE.md section 4.
- Stripe's per-transaction fees apply only once live payments are approved. Test mode is free.
- Migration 0017 allows `stripe` in the provider columns and adds the connected-account columns.
