# ADR-0013: Catalog, inventory, checkout and mock payments

Status: Accepted (engineering). The VAT and delivery assumptions below are proposed defaults that need founder approval (ADR-0007 D4, D7, D8).

Date: 2026-11-27

## Context

Phase 3 adds products, stock, carts and multi-seller checkout. The spec requires that stock never goes negative, that two shoppers can never both buy the last unit (T04), that one payment covers several sellers with a suborder each (T05), and that an order is paid only when the payment provider says so through a verified webhook (T06). No payment provider has been chosen (D5).

## Decision

**Listings.** Products follow the storefront pattern from ADR-0012: draft columns plus `live_*` columns. A first submission goes to the admin queue (`draft` or `rejected` to `submitted`). After approval, merchant edits set `changes_submitted_at` and wait for review while customers keep seeing the live copy. Admin actions (approve, reject, suspend, reinstate) carry the product version the reviewer saw, are audited and emit outbox events. SKUs are unique per business (database constraint).

**Inventory.** Each variant keeps `stock_on_hand` and `stock_reserved` with CHECK constraints `stock_reserved >= 0` and `stock_on_hand >= stock_reserved`, so no code path can oversell even if it has a bug. Every change writes an append-only `stock_movements` row. Manual adjustments need an `Idempotency-Key`. Any transaction that touches stock locks the order row first and then variant rows in ascending id order, which rules out deadlocks between concurrent checkouts.

**Cart and quote.** Guests get a cart token (only its SHA-256 is stored) and merge it into their account cart after sign-in. Cart prices are indicative. `POST /checkout/quote` prices the cart on the server, groups it by seller, adds each seller's delivery fee for the address's emirate and stores the result for 15 minutes.

**Order.** `POST /orders` takes the quote id and an `Idempotency-Key`. In one transaction it expires overdue orders, locks the variants, reprices, refuses with `QUOTE_STALE` if anything changed and `OUT_OF_STOCK` if stock is short, then creates the order, one merchant suborder per seller, order items with title and price snapshots, and reservations held for the 15-minute payment window. One order per quote is enforced by a unique constraint. The payment intent is created after the transaction with idempotency key `order-<id>`, so a provider outage leaves a retryable order (503 `PAYMENT_PROVIDER_UNAVAILABLE`), never a charged customer without an order.

**Payment.** A `PaymentProvider` interface with one implementation, the mock. The mock's hosted step (`POST /mock-psp/intents/:id/confirm`, only registered when `PSP_PROVIDER=mock`) never changes an order: it sends signed webhooks (`x-psp-signature: t=<unix>,v1=HMAC-SHA256("t.body")`, 5-minute tolerance) to `/webhooks/payments`, which verifies them over the raw body. `webhook_events` deduplicates by event id. A success converts reservations to sale movements and marks the order paid; a failure or expiry releases the stock. A payment that arrives after expiry is refunded automatically; if the refund fails the payment is flagged `needs_attention` and a `payment.manual_exception` event is queued. The worker runs the same SQL function the API uses (`expire_unpaid_orders`) every 30 seconds. Production refuses the mock (ADR-0006).

**Money.** Prices are VAT-inclusive; tax is extracted per line and on delivery with `half_up` rounding at the standard 5 % rate from an effective-dated `tax_rates` table. Zero-rated and exempt classes exist per variant.

**Delivery.** Each merchant sets zones per emirate with a fee, an optional free-delivery threshold and a delivery window (D8 default: merchant delivery). Checkout refuses an address no seller in the cart covers.

## Assumptions needing founder approval

- D4: prices shown are VAT-inclusive, rounding is `half_up` per line, delivery is standard-rated. Tax invoices are not issued yet.
- D7: returns and cancellations are not offered yet; the product page shows only whether the store accepts returns.
- D8: merchants deliver their own orders within zones they set.

## Deferred

Promotions and discount codes (the `discount_fils` columns exist and are always zero), customer and merchant order cancellation, admin order monitoring, fulfillment states after `paid` (phase 6), the real PSP, ledger and payouts (phase 5).

## Consequences

Overselling is prevented by the database, not only by code, and the integration tests run real concurrent checkouts against Postgres. The cost is that every checkout takes row locks; with stable lock order this is safe, and contention only affects shoppers buying the same variants at the same moment.
