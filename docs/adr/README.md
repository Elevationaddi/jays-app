# Architecture decision records

Each record states one decision, why it was made and what it costs. Records are numbered and never rewritten; a changed decision gets a new record that supersedes the old one.

Status values: **Accepted** (engineering decision, in force), **Proposed** (needs founder approval before production), **Superseded**.

| ADR                                                               | Title                                                                                                        | Status                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| [0001](0001-record-architecture-decisions.md)                     | Record architecture decisions                                                                                | Accepted                                |
| [0002](0002-monorepo-and-toolchain.md)                            | Monorepo and toolchain                                                                                       | Accepted                                |
| [0003](0003-application-stack.md)                                 | Application stack and modular monolith                                                                       | Accepted                                |
| [0004](0004-database-migrations-and-query-layer.md)               | Plain SQL migrations; Kysely instead of Prisma                                                               | Accepted                                |
| [0005](0005-money-time-and-localization.md)                       | Money, time and localization conventions                                                                     | Accepted                                |
| [0006](0006-environment-and-secrets.md)                           | Environment configuration, secrets and mock providers                                                        | Accepted                                |
| [0007](0007-founder-decisions-and-mvp-defaults.md)                | Founder decisions and MVP defaults                                                                           | Proposed                                |
| [0008](0008-api-conventions.md)                                   | API conventions: errors, request IDs, OpenAPI                                                                | Accepted                                |
| [0009](0009-identity-and-sessions.md)                             | Identity, verification and sessions                                                                          | Accepted                                |
| [0010](0010-authorization-and-admin-mfa.md)                       | Authorization model and admin MFA                                                                            | Accepted                                |
| [0011](0011-web-sessions-bff-cookies.md)                          | Web sessions through server-side cookies, and CSRF                                                           | Accepted                                |
| [0012](0012-merchant-onboarding-storage-and-review.md)            | Merchant onboarding, private files and admin review                                                          | Accepted                                |
| [0013](0013-catalog-inventory-checkout-and-mock-payments.md)      | Catalog, inventory, checkout and mock payments                                                               | Accepted                                |
| [0014](0014-services-staff-availability-and-booking.md)           | Services, staff, availability and booking                                                                    | Accepted                                |
| [0015](0015-ledger-refunds-payouts-and-reconciliation.md)         | Ledger, refunds, payouts and reconciliation                                                                  | Accepted                                |
| [0016](0016-fulfillment-returns-reviews-support-notifications.md) | Fulfillment, returns, reviews, support, notifications, dashboards and exports                                | Accepted                                |
| [0017](0017-hardening-observability-backups.md)                   | Hardening, observability, backups and staging                                                                | Accepted                                |
| [0018](0018-founder-decisions-2026-11-28.md)                      | Founder decisions D1–D15 (28 November 2026)                                                                  | Accepted                                |
| [0019](0019-account-privacy-consent-deletion.md)                  | Account privacy, marketing consent and account deletion                                                      | Accepted                                |
| [0020](0020-operations-controls.md)                               | Operations controls: categories, emirates and support                                                        | Accepted                                |
| [0021](0021-commission-vat-invoices-weekly-payouts.md)            | Commission by category, VAT, tax documents and weekly payouts                                                | Accepted                                |
| [0022](0022-home-services.md)                                     | Home services: licence review, coverage, travel fees and buffers                                             | Accepted                                |
| [0023](0023-product-discovery.md)                                 | Product discovery: sale prices, ratings, sorts, facets, wishlist and back-in-stock alerts                    | Accepted                                |
| [0024](0024-cost-constraints-and-vercel-first-architecture.md)    | No paid subscriptions beyond Vercel, ChatGPT and Claude; Vercel-first hosting; Supabase, Resend, FCM; no SMS | Accepted                                |
| [0025](0025-travel-fees-home-cancellations-pilot-promotion.md)    | Travel fees outside commission, home-visit cancellations, pilot 0% commission promotion                      | Accepted (cancellation policy proposed) |
| [0026](0026-service-discovery.md)                                 | Service discovery: add-ons, search, ratings, waitlists, reminders, rebooking and portfolios                  | Accepted                                |
| [0027](0027-booking-policies-and-component-amounts.md)            | No-show refunds, home-visit travel status, travel-fee refunds without commission, per-component amounts      | Accepted (home-visit rule proposed)     |
| [0028](0028-legal-documents-and-acceptance-records.md)            | Legal documents: drafts, versions, frozen published text, acceptance records; no approval recorded           | Accepted (all texts are drafts)         |
| [0029](0029-delivery-methods-return-policies-delivery-partner.md) | Delivery methods, return policies per business and category, optional delivery-partner interface             | Accepted (return rules proposed)        |
