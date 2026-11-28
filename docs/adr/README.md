# Architecture decision records

Each record states one decision, why it was made and what it costs. Records are numbered and never rewritten; a changed decision gets a new record that supersedes the old one.

Status values: **Accepted** (engineering decision, in force), **Proposed** (needs founder approval before production), **Superseded**.

| ADR                                                               | Title                                                                         | Status   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                     | Record architecture decisions                                                 | Accepted |
| [0002](0002-monorepo-and-toolchain.md)                            | Monorepo and toolchain                                                        | Accepted |
| [0003](0003-application-stack.md)                                 | Application stack and modular monolith                                        | Accepted |
| [0004](0004-database-migrations-and-query-layer.md)               | Plain SQL migrations; Kysely instead of Prisma                                | Accepted |
| [0005](0005-money-time-and-localization.md)                       | Money, time and localization conventions                                      | Accepted |
| [0006](0006-environment-and-secrets.md)                           | Environment configuration, secrets and mock providers                         | Accepted |
| [0007](0007-founder-decisions-and-mvp-defaults.md)                | Founder decisions and MVP defaults                                            | Proposed |
| [0008](0008-api-conventions.md)                                   | API conventions: errors, request IDs, OpenAPI                                 | Accepted |
| [0009](0009-identity-and-sessions.md)                             | Identity, verification and sessions                                           | Accepted |
| [0010](0010-authorization-and-admin-mfa.md)                       | Authorization model and admin MFA                                             | Accepted |
| [0011](0011-web-sessions-bff-cookies.md)                          | Web sessions through server-side cookies, and CSRF                            | Accepted |
| [0012](0012-merchant-onboarding-storage-and-review.md)            | Merchant onboarding, private files and admin review                           | Accepted |
| [0013](0013-catalog-inventory-checkout-and-mock-payments.md)      | Catalog, inventory, checkout and mock payments                                | Accepted |
| [0014](0014-services-staff-availability-and-booking.md)           | Services, staff, availability and booking                                     | Accepted |
| [0015](0015-ledger-refunds-payouts-and-reconciliation.md)         | Ledger, refunds, payouts and reconciliation                                   | Accepted |
| [0016](0016-fulfillment-returns-reviews-support-notifications.md) | Fulfillment, returns, reviews, support, notifications, dashboards and exports | Accepted |
