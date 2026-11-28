# Implementation status

Plan: [implementation-plan.md](implementation-plan.md). Decisions: [adr/](adr/README.md).

| Phase | Scope                                                        | Status                                |
| ----- | ------------------------------------------------------------ | ------------------------------------- |
| 0     | Monorepo, local Docker, env schema, CI, ADRs                 | Merged (PR #1)                        |
| 1     | Identity, roles, memberships, bilingual gateway              | Merged (PR #2)                        |
| 2     | Merchant onboarding, approval, categories, media, storefront | Merged (PR #3)                        |
| 3     | Catalog, inventory, cart, multi-seller checkout (mock PSP)   | Merged (PR #4)                        |
| 4     | Services, staff, availability, booking holds                 | Merged (PR #5)                        |
| 5     | Ledger, refunds, payouts, reconciliation (mock PSP)          | Merged (PR #6); real PSP needs D3, D5 |
| 6     | Fulfillment, reviews, support, notifications, dashboards     | Merged (PR #7); D7, D12, D14 assumed  |
| 7     | RTL/accessibility, hardening, backups, observability, pilot  | Merged (PR #8); pilot not started     |

## Phase 8: Complete application functionality

Founder decisions: [ADR-0018](adr/0018-founder-decisions-2026-11-28.md). Phase 8 ships as slices. Each slice is its own PR, merged once CI passes.

### 8.2 Account and privacy (D14, D15)

Decision: [ADR-0019](adr/0019-account-privacy-consent-deletion.md). Consent wording, the 14-day grace period and the retention list are proposed, pending legal approval.

- **Marketing consent per channel:** email, SMS and push, chosen separately at sign-up (never pre-ticked) and in settings. An append-only history records each grant and withdrawal with its source, language and policy version.
- **Notification preferences:** order and appointment updates by email, SMS and push. The dispatcher now skips email for people who switched it off. In-app notices and security codes always send.
- **One-click unsubscribe:** signed links that work without signing in (`/v1/unsubscribe`). The customer app has a screen for them.
- **Data export** as JSON (`GET /me/export`).
- **Account deletion:**
  - Needs the password and cannot go ahead with open orders, upcoming appointments, open returns or a business membership.
  - It can be canceled during 14 days. After that the worker anonymises the account and keeps financial records.
- **Screens:** Privacy and notifications (customer app), Unsubscribe, and per-channel sign-up choices in the customer app and the business portal.
- **API:** 5 new paths (165 in total), migration 0008.

### 8.1 Customer app after-sales, branding, decisions record

- **Customer app:**
  - The order screen gains tracking, cancel before processing (full refund), returns (choose quantities and a reason), returns history, reviews of delivered items, and "Get help".
  - Appointments: a review after completion, and "Get help".
  - New screens: Help and support (list, new request prefilled from an order or appointment, conversation with replies) and Notifications (marked read on open).
  - The account screen links to both, with an unread count.
- **Branding (D1):** "JAYS" is set once in `packages/i18n/src/brand.ts`. Web titles, top bars, the customer app and the admin authenticator issuer follow it. Colors stay in `@jays/ui`.
- **ADR-0018:** records D1–D15, separating approved technical work from proposed commercial and legal terms.
- **Status:** phase 7 is marked merged.
- **Screenshots:** [`docs/screenshots/phase-8/`](screenshots/phase-8/) shows the customer app (phone size, web build) in English and Arabic. The orders and the ticket come from the API, paid through the mock provider.
- **Checks:** format, lint, typecheck and OpenAPI unchanged. 230 unit tests and 160 integration tests pass.

## Phase 7: Hardening, observability, backups and staging

Date: 2026-11-28. Branch: `claude/project-thread-qyds1l`. Merged in PR #8. Decision: [ADR-0017](adr/0017-hardening-observability-backups.md). Hosting, alerting destination, backup storage and pilot scope are not decided, so staging is ready to deploy but no pilot was started.

### Delivered

- **Observability:**
  - Token-protected `GET /v1/metrics` in Prometheus format: request counts, a latency histogram labelled by route pattern, outbox lag, stuck holds and reservations, payments needing attention, reconciliation mismatches, overdue tickets.
  - `METRICS_TOKEN` is required in production.
  - 11 alert rules and a runbook with a section for each alert.
- **Failed notifications:** admins can list events that used every attempt and queue them again, audited (`GET /admin/notifications/failed`, `POST /admin/notifications/failed/:id/retry`). The admin console Notifications page shows them in English and Arabic.
- **Backups (T12):**
  - Encrypted `pg_dump` with a checksum, and a restore that checks it and runs in one transaction.
  - A restore drill that compares every table's row count, the migrations, the ledger balance and the append-only triggers. CI runs it on every push.
- **Concurrency tests:** ship against cancel, double-submitted fulfillment steps, parallel return requests and parallel reviews. One request wins, and stock and refunds match the winner.
- **T14:** unit tests for Dubai midnight boundaries in dashboard ranges.
- **Accessibility (T11):** an axe-core audit script for both portals in English and Arabic.
- **Load:** a read load test script with a p95 target.
- **Staging:**
  - A `Dockerfile` with four targets.
  - A single-host staging compose (migrate first, mock adapters, ports bound to localhost behind TLS).
  - A CI job that builds every image, migrates, starts the stack and checks readiness and metrics.
- **Screenshots:** [`docs/screenshots/phase-7/`](screenshots/phase-7/) shows failed notifications in English and Arabic, and the result of a retry.

### Verified locally (2026-11-28)

| Command                           | Result                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`               | pass                                                                                                                       |
| `pnpm lint`                       | pass                                                                                                                       |
| `pnpm typecheck`                  | pass                                                                                                                       |
| `pnpm test`                       | pass, 228 unit tests                                                                                                       |
| `pnpm build`                      | pass                                                                                                                       |
| `pnpm openapi`                    | 160 paths; committed with the code                                                                                         |
| `pnpm test:integration`           | pass, 160 tests (22 database, 138 API against Postgres and Redis)                                                          |
| `infra/backup/drill.sh`           | pass: 69 tables match, migrations match, ledger balanced, append-only triggers present                                     |
| `node scripts/a11y/audit.mjs`     | 74 page views (business portal and admin console, English and Arabic), 0 violations of any severity                        |
| `node scripts/load/read-load.mjs` | 50 users for 30 s: 16,111 requests at 536 req/s, p95 218 ms (target 500 ms), slowest is availability at 264 ms, 0 failures |

The Docker images could not be built in this environment (no Docker daemon); CI builds and starts them.

Full regression of T01 to T16 is the API integration suite, which runs in CI on every push:

- T01 to T09: earlier phases.
- T10 and T12: phase 6 and this phase.
- T13 to T16: phases 3 to 5, plus the T14 unit tests above.

### Known limitations and follow-ups

- The load test ran on seed-sized data on one machine. Repeat it on staging with pilot-sized data.
- The customer mobile app has no accessibility audit yet. It needs a device or simulator pass with VoiceOver and TalkBack. The app also still lacks its after-sales screens (phase 6 follow-up).
- The images include development dependencies. Slimming them is an optimisation, not a blocker.
- No security scanner beyond the CI secret scan and dependency audit (for example, OWASP ZAP against staging). Run one once staging is hosted.
- Production cannot start until real payment, email/SMS, storage and malware-scanning adapters exist. Those depend on D3, D5 and D14.

### Rollback

No migration. Reverting the PR removes the metrics endpoint, the retry endpoints and the scripts. `METRICS_TOKEN` then becomes an unknown variable, which the environment schema ignores.

## Phase 6: Fulfillment, returns, reviews, support, notifications, dashboards and exports

Date: 2026-11-28. Branch: `claude/project-thread-qyds1l`. Merged in PR #7. Decision: [ADR-0016](adr/0016-fulfillment-returns-reviews-support-notifications.md). The return window (D7), support hours (D12) and email/SMS providers (D14) are assumptions until the founders decide.

### Delivered

- Migration `0007_fulfillment_reviews_support.sql`:
  - Fulfillment columns on suborders, with CHECKs (shipped needs tracking; delivered needs shipped).
  - Append-only order timeline (`merchant_order_events`).
  - Returns and return items; one open return per suborder. Refunds gain reason `return`, linked to the return.
  - Reviews (one per delivered item or completed booking), append-only replies, and reports (one open per review).
  - Support tickets and append-only messages. Only admins can write internal notes.
  - Versioned notification templates (seeded in English and Arabic), in-app notifications, and delivery records.
- Domain package: fulfillment and return transitions, the return window, per-unit return amounts, review eligibility (T10), ticket transitions, template rendering, and notification backoff.
- API (158 paths, up from 126):
  - **Merchants:** fulfil (process, ship with tracking, deliver, cancel with full refund and restock), returns (approve, reject, receive and refund), reviews (reply, report), dashboard, statement CSV.
  - **Customers:** cancel before processing, request returns, review, support tickets, notifications.
  - **Public:** product and venue reviews with averages.
  - **Admin:** dashboard, cross-merchant orders (with "stuck"), review moderation, support queue (assign, reply, internal note, resolve), notification templates and outbox health, CSV exports.
- Notification dispatcher in the API: outbox to in-app and email, at most once per recipient and channel, exponential retry, failed after 6 attempts.
- Business portal: Dashboard, Returns and Reviews tabs; the order page gains fulfilment actions and a timeline.
- Admin console: real Dashboard with open work and exports, plus Orders, Support (queue and ticket), Reviews and Notifications pages.
- Screenshots: [`docs/screenshots/phase-6/`](screenshots/phase-6/) (15 screens, English and Arabic RTL). They come from real orders paid through the mock provider, then shipped, delivered, returned, reviewed and discussed with support through the API. To place enough orders, the demo raised the demo shop's stock directly in the local database.

### Verified locally (2026-11-28)

| Command                 | Result                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `pnpm format:check`     | pass                                                              |
| `pnpm lint`             | pass                                                              |
| `pnpm typecheck`        | pass                                                              |
| `pnpm test`             | pass, 220 unit tests                                              |
| `pnpm build`            | pass                                                              |
| `pnpm openapi`          | 158 paths; committed with the code                                |
| `pnpm test:integration` | pass, 153 tests (22 database, 131 API against Postgres and Redis) |

Acceptance coverage:

- **T10:** an item can be reviewed only after delivery, and an appointment only after completion. Only the buyer can review it, and only once. Hidden reviews leave the public list and the average. Only admins with `reviews.moderate` can hide a review, with a reason, and the action is audited.
- **T12:** a failed email backs off and is retried. A replay sends no duplicate email or in-app notification. After 6 failures the event is marked failed and shows on outbox health.
- **Fulfillment:** version conflicts, shipping without tracking and invalid transitions are refused. A customer can cancel before processing, a merchant before dispatch; both restock and refund the whole suborder. Another business cannot act on a suborder (tenant isolation).
- **Returns:** only after delivery and within 14 days, never more units than were bought, and the refund settles by webhook.
- **Support:** internal notes are never shown to the customer. A ticket cannot point at someone else's order. A customer reply reopens a resolved ticket.
- **Dashboards and exports:** figures match the orders in the range. Exports are CSV with no contact details, and each one is audited. Roles without the capability get 403.

### Known limitations and follow-ups

- The customer mobile app does not yet have cancel, return, review, support or notification screens. The API and client methods are ready.
- No SMS notifications, and no real email provider (D14).
- Returns are refunded only by the merchant marking them received. Admins can refund through Finance if a merchant does not respond.
- Moderation guidelines for reviews are not written yet.

## Phase 5: Ledger, refunds, payouts and reconciliation (mock PSP)

Date: 2026-11-28. Branch: `claude/project-thread-qyds1l`. Decision: [ADR-0015](adr/0015-ledger-refunds-payouts-and-reconciliation.md). The real-provider adapter is still open, because the PSP and the merchant-of-record model are founder decisions (D3, D5). Everything else in the phase is built against the mock provider.

### Delivered

- Migration `0006_finance.sql`:
  - Effective-dated fee rules and finance settings. Fee rules are append-only.
  - Merchant earnings, which keep the commission rate captured at payment.
  - A double-entry ledger. It is append-only, idempotent per source event, and a deferred trigger refuses unbalanced transactions.
  - Refund requests, with a CHECK constraint that the approver is not the requester.
  - Disputes (one open per earning) and payout holds (one active per business).
  - Payouts, and reconciliation runs and items.
  - Refunds can never exceed the captured amount (trigger `refunds_within_capture`).
  - SQL function `mark_earnings_eligible`, shared by the API and the worker.
- Domain package: fee rule selection, commission and net, proportional refund allocation, ledger postings, the payout amount, the second-approval rule, and payment status after refunds.
- Payments: captures, late payments, refunds and payouts post to the ledger. Several partial refunds are allowed. The provider interface gains `createPayout` and `listRecords`. The mock provider records refunds and payouts and has test seams for dropped webhooks, failed payouts and tampered amounts.
- API (126 paths, up from 106):
  - Admin (`/admin/finance`): overview, fee rules, settings, payments, refund requests and decisions, earnings, disputes, holds, payouts and payout runs, reconciliation runs and finding resolution.
  - Business: `/businesses/:id/finance/{summary,earnings,ledger,payouts}`.
- Worker: marks earnings eligible every 10 minutes. The API reconciles the previous day hourly.
- Admin console Finance section with seven tabs:
  - **Overview:** balances, items needing attention, last reconciliation, versioned settings and commission rules.
  - **Payments:** payment detail with per-seller refunds.
  - **Refunds:** approvals by a second admin.
  - **Payouts:** holds and payout runs.
  - **Earnings:** opening disputes.
  - **Disputes**
  - **Reconciliation**
- Business portal Finance tab: balance owed, ready for payout, pending, on its way, paid out and commission, plus earnings, payouts and a statement. Owners and finance members see it.
- Seed data: placeholder 10 % platform commission for local use only, labelled as not founder-approved.
- Screenshots: [`docs/screenshots/phase-5/`](screenshots/phase-5/) (14 screens, English and Arabic RTL). They come from real bookings paid through the mock provider. To make some earnings eligible, the demo moved those appointments' completion ten days into the past in the local database.

### Verified locally (2026-11-28)

| Command                                | Result                                                            |
| -------------------------------------- | ----------------------------------------------------------------- |
| `pnpm format:check`                    | pass                                                              |
| `pnpm lint`                            | pass                                                              |
| `pnpm typecheck`                       | pass                                                              |
| `pnpm test`                            | pass, 211 unit tests                                              |
| `pnpm build`                           | pass (packages, API, worker, both Next.js apps)                   |
| `pnpm openapi`                         | 126 paths; committed with the code                                |
| `pnpm db:migrate` on an empty database | applied 0001 to 0006                                              |
| `pnpm test:integration`                | pass, 137 tests (22 database, 115 API against Postgres and Redis) |

Acceptance coverage:

- **T06:** a capture posts one balanced transaction even when the webhook is duplicated. Multi-seller orders split into one earning per seller, with commission on goods only. The database refuses unbalanced, edited or deleted ledger rows, and a second posting for the same source event.
- **T09:**
  - Refunds at or below the threshold go through at once, and several partial refunds are allowed.
  - More than was paid is refused by the API (422) and by a database trigger.
  - An open dispute keeps its earning out of payouts. A lost dispute after payout leaves a negative balance, which the next payout recovers.
- **T13:** an earning keeps the commission rate in force at payment after the rule changes. Rules and settings are versioned and cannot take effect in the past.
- **T15:** a lost payment webhook and a lost refund webhook are recovered by reconciliation through the normal webhook path, exactly once. A different amount is flagged and left unchanged until finance marks it handled. A day can be reconciled only once, and only after it has ended.
- **T16:** a refund above the threshold waits for a second admin. The requester cannot approve it, in the API (403) or in the database.
- Also covered: payouts settle by webhook, failed payouts return earnings and reverse the ledger, holds and suspensions skip a business, and a business sees only its own finance data. Support can refund but cannot manage rules or payouts.

### Known limitations and follow-ups

- No real PSP adapter yet (D5), and the merchant-of-record model is assumed (D3). Commission rates (D2), VAT on commission (D4) and payout timing (D6) are placeholders. See the ADR-0015 assumptions.
- Payout destinations (bank details) are not collected. The provider is assumed to hold them.
- Payouts run when an admin starts them, not on a schedule.
- Shop earnings become eligible only after delivery, which phase 6 records.
- Admins enter a business id to place a hold. A business picker would be friendlier.
- Arabic copy for this phase needs review by a native speaker before the pilot.

### Rollback

`0006_finance.sql` adds tables and functions, and a few nullable columns and widened checks on existing tables. Rolling back means deploying the previous code. Do not delete ledger rows: they are append-only by design.

## Phase 4: Services, staff, availability and booking

Date: 2026-11-27. Branch: `claude/project-thread-qyds1l`. Decision: [ADR-0014](adr/0014-services-staff-availability-and-booking.md). Detail: [implementation plan](implementation-plan.md#phase-4-services-branches-staff-availability-booking-holds).

### Delivered

- Migration `0005_services_booking.sql`:
  - Tables: branches with weekly hours and closures, services with branch links, and staff with branch and service links.
  - Staff schedules: weekly shifts and dated blocks.
  - Bookings with price and policy snapshots. An exclusion constraint stops one professional's held, confirmed or checked-in bookings from overlapping.
  - SQL function `expire_booking_holds`, shared by the API and the worker.
- API (106 paths under `/v1`, up from 81):
  - Merchant: branches, closures, services, staff, weekly shifts and blocks. Every edit is refused with `SCHEDULE_CONFLICT` if it would strand an upcoming booking.
  - Public: venue page data, and availability per day in branch time on a 15-minute grid with buffers.
  - Customer:
    - Holds are idempotent and last 10 minutes. A customer may have at most 2 open holds and book up to 60 days ahead.
    - Payment uses the mock PSP, and only a verified webhook confirms a booking.
    - Customers can list bookings, cancel under the policy snapshot and reschedule in place.
  - Merchant calendar with check-in, complete, no-show and cancel (with a version check), plus phone and walk-in bookings. Professionals see only their own appointments.
  - Admin: booking monitoring with payment-attention flags, and service suspension and reinstatement with reasons and audit.
  - Payments: refunds are requested inside the transaction and issued after commit, with partial-refund status, for orders and bookings alike.
- Worker: expires booking holds every 30 seconds.
- Business portal:
  - Calendar: a day view per branch, with actions and manual bookings.
  - Services page with branches: hours, closures, services, prices, buffers and policy.
  - Staff page: branches, services, linked member, weekly shifts, breaks and leave.
- Admin console: Services (suspend and reinstate) and Bookings.
- Customer app:
  - Venue services on the store page in services mode.
  - Booking flow: professional, day, time, hold, mock payment, and a confirmation that waits for the webhook.
  - My appointments: upcoming and past, with detail, cancel (showing the refund) and change time.
- Seed data: Lumière Salon (1 branch, 3 services, 3 staff, one linked to `staff.pro`) and Oud & Bloom (1 spa branch, 2 services, 2 staff), with weekly hours and shifts.
- Screenshots: [`docs/screenshots/phase-4/`](screenshots/phase-4/) (18 screens, English and Arabic RTL, phone and desktop).

### Verified locally (2026-11-27)

| Command                                | Result                                                            |
| -------------------------------------- | ----------------------------------------------------------------- |
| `pnpm format:check`                    | pass                                                              |
| `pnpm lint`                            | pass, 12 projects                                                 |
| `pnpm typecheck`                       | pass, 12 projects                                                 |
| `pnpm test`                            | pass, 195 unit tests                                              |
| `pnpm build`                           | pass (packages, API, worker, both Next.js apps)                   |
| `pnpm openapi`                         | 106 paths; committed with the code                                |
| `pnpm db:migrate` on an empty database | applied 0001 to 0005                                              |
| `pnpm test:integration`                | pass, 118 tests (15 database, 103 API against Postgres and Redis) |
| `pnpm db:seed`                         | seeds 2 venues; the booking flow was run end to end in the app    |

Acceptance coverage:

- **T07:** two simultaneous holds for the same professional and time produce exactly one booking. A burst of "any professional" holds never books more people than exist. A direct database insert that bypasses the API is also refused.
- **T08:**
  - Only the verified webhook confirms a booking, and a retried hold returns the same booking.
  - An expired hold frees the time and cannot be paid. A late payment is refunded in full, and a failed payment releases the time at once.
  - The hold cap and the 15-minute grid are enforced, and "any professional" goes to whoever has fewer appointments that day.
- **T09:** cancellation is refunded in full before the cutoff and at the late share after it. The customer cannot cancel once the appointment starts, and a business cancellation is always refunded in full.
- **T13 (services):** a booking keeps the price, duration and policy it was sold with after the service changes.
- **T14:** a booking just after local midnight in Dubai lands on the previous UTC day. Daylight-saving gaps and overlaps are covered in the domain tests.
- Also covered: schedule edits that would strand a booking are refused and rolled back; rescheduling keeps the original time when the new one is taken; manual bookings follow the same rules; professionals see only their own appointments; businesses and customers cannot see each other's bookings; a suspended service cannot be booked.

### Known limitations and follow-ups

- Payments use the mock provider only (D5). Booking revenue does not reach a ledger or payouts until phase 5.
- **Services go live without admin pre-approval:** once the business and its services mode are approved, services are bookable straight away, and admins can suspend them. Cancellation policies are set per service by the merchant (D7, proposed). Services are in-venue only (D9, proposed).
- **Not built yet:** merchant-side rescheduling, deposits, packages, waitlists and reminders. Reminders arrive with notifications in phase 6.
- **Shifts:** the portal edits one shift per day per professional, although the API accepts several.
- **Sign-in during booking:** signing in part-way through returns the customer to the booking page, but they have to pick the time again.
- Arabic copy for this phase needs review by a native speaker before the pilot.

### Rollback

`0005_services_booking.sql` only adds tables, a constraint on the new bookings table and functions. Rolling back means deploying the previous code; the new tables are then unused.

## Phase 3: Catalog, inventory, cart, multi-seller checkout (mock PSP)

Date: 2026-11-27. Branch: `claude/project-thread-qyds1l`. Merged in PR #4. Decision: [ADR-0013](adr/0013-catalog-inventory-checkout-and-mock-payments.md). Detail: [implementation plan](implementation-plan.md#phase-3-catalog-inventory-cart-multi-seller-checkout-mock-psp).

### Delivered

- Migration `0004_catalog_checkout.sql`: products (draft and live copies), product images, variants with stock CHECK constraints, append-only stock movements, delivery zones, carts, quotes, orders, merchant suborders, order items, reservations, payments, refunds, webhook events, idempotency keys and tax rates; SQL functions `release_order_reservations` and `expire_unpaid_orders` shared by the API and the worker.
- API (81 paths under `/v1`, up from 54):
  - Merchant products and variants, product images, submission and archive; inventory list, idempotent adjustments and movement history; delivery zones; merchant suborders.
  - Admin listing queue and detail with approve, reject, suspend and reinstate (version precondition, reasons, audit, outbox).
  - Public product search and filters (text, category, brand, store, price, availability, sort) and product detail.
  - Guest and account carts with merge after sign-in, a 15-minute server-priced quote, idempotent `POST /orders`, order history and detail.
  - Mock PSP hosted step and signed webhook endpoint with replay protection, late-payment refunds and manual-exception flags.
- Worker: expires unpaid orders and releases held stock every 30 seconds.
- Business portal: Products (list, create, edit, images, variants, submit, archive), Inventory (adjust with reason), Delivery zones and Orders.
- Admin console: Listings queue and review page.
- Customer app: product grid on the shop home and store pages, product page with variant choice and stock state, cart grouped by store, checkout with address, quote, mock payment and confirmation that waits for the webhook, and My orders.
- Seed data: 7 fictional products (5 live including partly and fully sold-out variants, 1 in review, 1 draft), delivery zones for both shops and a saved address for `customer.en`.
- Screenshots: [`docs/screenshots/phase-3/`](screenshots/phase-3/) (19 screens, English and Arabic RTL, phone and desktop).

### Verified locally (2026-11-27)

| Command                                | Result                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`                    | pass                                                            |
| `pnpm lint`                            | pass, 12 projects                                               |
| `pnpm typecheck`                       | pass, 12 projects                                               |
| `pnpm test`                            | pass, 169 unit tests                                            |
| `pnpm build`                           | pass (packages, API, worker, both Next.js apps)                 |
| `pnpm openapi`                         | 81 paths; committed with the code                               |
| `pnpm db:migrate` on an empty database | applied 0001 to 0004                                            |
| `pnpm test:integration`                | pass, 94 tests (15 database, 79 API against Postgres and Redis) |
| `pnpm db:seed`, run twice              | idempotent                                                      |

Acceptance coverage:

- **T04:** two customers race for the last unit and exactly one order succeeds; a burst of concurrent checkouts never takes stock below zero or above what was on hand.
- **T05:** one payment for two sellers creates two suborders whose totals add up to the order total, and a duplicate checkout with the same key returns the same order.
- **T06 (mock):** failed payment releases stock; expiry releases stock and a late success is refunded; a failed refund is flagged for manual handling; duplicate and replayed webhooks change nothing; bad, missing and stale signatures are refused.
- **T13 (products):** a changed price or expired quote is refused with a fresh quote needed, and order history keeps the price and title paid even after the merchant edits the product.
- **T01 (cart):** a guest cart is merged into the account after sign-in, and the app keeps the cart across mode switches.
- Listings: unapproved products and their images are invisible, edits to live listings wait for review, suspension hides a product at once, SKUs are unique per business, foreign images are refused, and staff without the capability get 403.

### Known limitations and follow-ups

- Payments use the mock provider only (D5). Production refuses to start with it.
- Prices are treated as VAT-inclusive with half-up rounding (D4, proposed); tax invoices are not produced yet.
- No promotions, no order cancellation by customer or merchant, and no admin order monitoring yet. Fulfillment after "paid" (processing, shipped, delivered) arrives in phase 6.
- Product search is a simple text match (`ILIKE`) in both languages; a search index can follow if the catalog grows.
- The mock PSP keeps intents in memory, so restarting the API forgets unpaid local intents (they expire normally).
- Arabic copy for this phase needs review by a native speaker before the pilot.

### Rollback

`0004_catalog_checkout.sql` widens one CHECK constraint on `media.purpose` and otherwise only adds tables and functions. Rolling back means deploying the previous code; the new tables are then unused.

## Phase 2: Merchant onboarding, approval, categories, media, storefront

Date: 2026-11-27. Branch: `claude/project-thread-eooims`. Merged in PR #3. Decision: [ADR-0012](adr/0012-merchant-onboarding-storage-and-review.md). Detail: [implementation plan](implementation-plan.md#phase-2-merchant-onboarding-approval-categories-media-storefront).

### Delivered

- Migration `0003_merchant_onboarding.sql`: legal profile, address, agreement, review and suspension columns plus a version counter on `businesses`; per-mode review columns; new tables `verification_documents`, `media`, `storefronts` (draft and live copies), `categories` (one mode, at most three levels, depth set by trigger) and `brands`. The MVP category tree is seeded in English and Arabic, without medical categories (D10).
- API (54 paths under `/v1`, up from 31):
  - Merchant onboarding: legal profile, agreement acceptance, private document upload, check, download and removal, submission with a server-side checklist.
  - Storefront editing with logo and banner uploads; after approval, edits wait for review while the live copy stays public.
  - Admin review queue and detail, audited document downloads, and nine typed review actions with reasons, a version precondition, row locks, audit entries and outbox events.
  - Admin categories and brands; public categories, brands, approved stores and store images.
- Files: signed upload tickets, real type from magic bytes, size and image dimension rules, a malware scanner adapter (mock flags EICAR), refused files deleted. Local storage adapter with HMAC-signed links; production refuses the local storage and mock scanner.
- Business portal: Verification page (legal details, documents, payouts note, agreement, checklist, modes, submit or resubmit), Storefront page (both languages, logo and banner, preview, pending and rejected notices), and shared workspace tabs.
- Admin console: business review queue with status filters, business detail with legal profile, documents, submitted and live storefront, history and only the decisions the reviewer's role allows; categories and brands.
- Customer app: categories and approved stores on each mode's home, and a store page. Nothing appears before approval.
- Seed data: Noor Beauty Supply (shop), Lumière Salon (services) and Oud & Bloom (hybrid) approved and public; Saffron Skin Co. waiting in the review queue; Amber Atelier as an empty draft to try the forms. Subcategories and three fictional brands.
- Screenshots: [`docs/screenshots/phase-2/`](screenshots/phase-2/) (14 screens, English and Arabic RTL, phone and desktop).

### Verified locally (2026-11-27)

| Command                                            | Result                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`                                | pass                                                            |
| `pnpm lint`                                        | pass, 12 projects                                               |
| `pnpm typecheck`                                   | pass, 12 projects                                               |
| `pnpm test`                                        | pass, 144 unit tests                                            |
| `pnpm build`                                       | pass (packages, API, worker, both Next.js apps)                 |
| `pnpm openapi`                                     | 54 paths; committed with the code                               |
| `pnpm db:migrate` on an empty database, then again | applied 0001 to 0003, then "database is up to date"             |
| `pnpm test:integration`                            | pass, 74 tests (15 database, 59 API against Postgres and Redis) |
| `pnpm db:seed`, run twice                          | idempotent; refuses `APP_ENV=production`                        |

Acceptance coverage: **T02** (a pending merchant is invisible, an approved one shows only live content, suspension hides it at once and reactivation restores it), audit entries for every review action and document read, concurrent reviewer decisions (only one wins), role boundaries for each admin action, cross-business media refused by the API and the database, and upload refusals (wrong type, infected, oversize, tampered or expired links).

### Known limitations and follow-ups

- Production storage (S3-compatible) and a real malware scanner are not implemented. Production refuses to start without them, so this blocks deployment until the hosting decision is made.
- Bank and PSP onboarding is not collected until the provider is chosen (D5). The portal says so.
- The merchant agreement text and version are placeholders (`merchant-draft-2026-11`, D13).
- Expired pending uploads are not cleaned up yet (worker job later). Documents are reviewed with the business, not one by one. A licence that expires after approval does not yet trigger reminders or suspension.
- The portals relay uploads through their own server instead of uploading straight from the browser.
- Arabic copy for this phase needs review by a native speaker before the pilot.

### Rollback

`0003_merchant_onboarding.sql` adds columns with defaults and new tables only. Rolling back means deploying the previous code; the new columns and tables are ignored by it. Uploaded files live under `STORAGE_LOCAL_DIR` locally and can be deleted with the database.

## Phase 1: Identity, roles, memberships, bilingual gateway

Date: 2026-11-27. Branch: `claude/project-thread-i0hr4p`. Merged in PR #2. Decisions: [ADR-0009](adr/0009-identity-and-sessions.md), [ADR-0010](adr/0010-authorization-and-admin-mfa.md), [ADR-0011](adr/0011-web-sessions-bff-cookies.md). Detail: [implementation plan](implementation-plan.md#phase-1-identity-roles-memberships-bilingual-gateway).

### Delivered

- Migration `0002_identity.sql` with 13 tables, the 7 emirates seeded in English and Arabic, an append-only audit log enforced by a trigger, and CHECK constraints for contact, status and permission vocabularies.
- API (31 paths under `/v1`):
  - Customer and business-user auth: register, verify, resend, login, refresh, logout and password reset.
  - Profile and addresses.
  - Memberships with accept and decline.
  - Businesses, mode activation and team management.
  - Admin auth with TOTP, admin invitations, the admin list and the audit log.
  - The emirates reference list.
- Security:
  - Argon2id passwords and HMAC'd one-time codes, with expiry, attempt lockout, resend cooldown and send limits.
  - Redis rate limits that fail closed.
  - Rotating refresh tokens with reuse detection, checked against the session on every request.
  - Default-deny business capabilities; mandatory TOTP for admins, with replay protection and encrypted secrets.
- Customer app: bilingual welcome with Shop Products / Book Services, emirate choice (manual, or suggested from location), a mode switch that persists, sign in/up, verification, password reset and account.
- Business portal: sign in/up, verification, the workspace gateway with mode cards and onboarding state, start a business, team management and invitations.
- Admin console: sign in with TOTP, invite acceptance and authenticator enrolment, admin accounts and the audit log.
- `packages/api-client` (typed client shared by all three apps), a large en/ar message catalog, and fictional seed data (`pnpm db:seed`).
- Screenshots: [`docs/screenshots/phase-1/`](screenshots/phase-1/) (21 screens, English and Arabic RTL, phone and desktop).

### Verified locally (2026-11-27)

| Command                                               | Result                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`                                   | pass                                                            |
| `pnpm lint`                                           | pass, 12 projects                                               |
| `pnpm typecheck`                                      | pass, 12 projects                                               |
| `pnpm test`                                           | pass, 126 unit tests                                            |
| `pnpm build`                                          | pass (packages, API, worker, both Next.js apps)                 |
| `pnpm openapi`, run twice                             | identical output (31 paths); committed with the code            |
| `pnpm db:migrate` on an empty `jays_test`, then again | applied 0001 and 0002, then "database is up to date"            |
| `pnpm test:integration`                               | pass, 54 tests (10 database, 44 API against Postgres and Redis) |
| `pnpm db:seed`, run twice                             | idempotent; refuses `APP_ENV=production`                        |
| `pnpm audit --prod --audit-level high`                | pass (1 moderate: `minimatch` inside Expo build tooling)        |

### Known limitations and follow-ups

- Two simultaneous refreshes with the same token sign the user out (strict reuse detection, ADR-0009). The portals and the app are built to avoid it. A short grace window is the follow-up if the pilot shows it.
- Email and SMS go only to the mock notifier. Choosing real providers and UAE sender-ID registration are founder decisions ([ADR-0007](adr/0007-founder-decisions-and-mvp-defaults.md) D14).
- The terms version is a placeholder (`draft-2026-11`, D13), and the marketing consent wording is a placeholder (D15).
- Arabic copy was written for this phase and needs review by a native speaker before the pilot.
- Platform roles other than superadmin and compliance can sign in but have no capabilities until their features arrive.
- Admin MFA recovery is re-invitation by a superadmin. A documented recovery runbook comes with phase 7.
- The Expo app is exported for web to take screenshots. Native builds (EAS) are not set up yet.

### Rollback

`0002_identity.sql` only adds tables and functions. Runners are forward-only, so rolling back means deploying the previous code and either leaving the new tables unused or dropping them in a new migration. No environment is in production yet, so locally `docker compose down -v` (or dropping the database) resets everything.

## Phase 0: Foundation

Date: 2026-11-27. Branch: `phase-0/scaffold`. Merged in PR #1.

### Delivered

- pnpm workspace with 5 apps and 6 packages, strict TypeScript 6.0, ESLint 10, Prettier, Vitest 5.
- `apps/api`: NestJS 12 with `/v1/health` and `/v1/health/ready`, request IDs, redacted structured logs, error envelope, helmet, CORS allow-list, env validation at boot, generated OpenAPI 3.1 (`apps/api/openapi.json`).
- `apps/worker`: validated env, Redis check, structured logs, graceful shutdown. No job handlers yet.
- `apps/business`, `apps/admin`: Next.js 16 foundation pages with English/Arabic and RTL from cookie or Accept-Language.
- `apps/customer`: Expo SDK 58 foundation screen using device language and RTL.
- `packages/config`: environment schema with production guards (no mock PSP, no dev switches, no committed example secrets).
- `packages/domain`: integer-fils money with explicit rounding, modes, roles, timezone helpers.
- `packages/contracts`, `packages/i18n`, `packages/ui`: error/pagination/health contracts, en/ar catalogs, design tokens with WCAG AA contrast tests.
- `packages/db`: forward-only SQL migration runner (advisory lock, per-file transaction, checksum enforcement) and `0001_extensions.sql`.
- Docker Compose (PostgreSQL 17, Redis 7, separate `jays_test` database), CI (verify, integration, security), ADRs 0001–0008.

### Verified locally (2026-11-27)

| Command                                                    | Result                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                        | pass                                                                                                                      |
| `pnpm lint`                                                | pass, 11 projects                                                                                                         |
| `pnpm typecheck`                                           | pass, 11 projects                                                                                                         |
| `pnpm test`                                                | pass, 74 unit tests                                                                                                       |
| `pnpm build`                                               | pass (packages, API, worker, both Next.js apps)                                                                           |
| `pnpm openapi:check`                                       | pass                                                                                                                      |
| `pnpm db:migrate` on empty `jays_test`, then again         | applied 0001, then "database is up to date"                                                                               |
| `pnpm test:integration`                                    | pass, 6 tests (extensions, idempotency, exclusion constraint, runner safety, API readiness against real Postgres + Redis) |
| `curl localhost:3000/v1/health/ready` with the API running | `200 {"status":"ready","checks":{"database":"up","redis":"up"}}`                                                          |

### Not in this phase

- Seed data: there are no domain tables yet; seeds start in phase 1.
- Screenshots: the web and mobile foundation pages show only the surface name and a "features arrive in later phases" notice; real screens and screenshots start in phase 1.
- The Expo app is type-checked, linted and unit-tested in CI but not built into a binary (EAS builds come with the first real screens).

### Rollback

Phase 0 adds no domain tables. `0001_extensions.sql` only creates extensions; dropping the local database or `docker compose down -v` resets everything.
