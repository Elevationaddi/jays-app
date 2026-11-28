# Abu Dhabi pilot plan

Status: **prepared, not launched.** The pilot starts only with the founder's explicit approval. No business has been enrolled, no merchant contacted and no message sent. Everything below is a plan for the founder to approve or change.

Last updated: 28 November 2026. Decisions: D11, D11a, D12 in the [founder decision register](FOUNDER_DECISIONS.md); [ADR-0025](adr/0025-travel-fees-home-cancellations-pilot-promotion.md) and [ADR-0034](adr/0034-pilot-promotion.md).

## 1. Scope

| Item       | Plan                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Emirate    | Abu Dhabi                                                                                                     |
| Businesses | 30 product businesses and 20 service businesses, each approved by the founder by name                         |
| Length     | 30 days from launch                                                                                           |
| Commission | **0% platform commission for each approved business's first 30 days**, then the standard rate (10%)           |
| Not waived | Payment processing charges (Stripe) and taxes                                                                 |
| Customers  | Invited testers first, then the public in Abu Dhabi if the week-1 review passes (founder decision)            |
| Payments   | Stripe **test mode** unless the founder approves live payments (D5). A pilot on test mode takes no real money |
| Support    | 9 AM–9 PM UAE time, first response within 24 hours (D12)                                                      |

## 2. What the software already does (phase 12)

- **Admin console, Pilot page** (finance admins): records a business's 0% offer with the founder's approval reference, shows enrolled businesses against the 30 and 20 targets, each window, sales during the offer, and who recorded it. A business outside Abu Dhabi is flagged. An offer can be ended early with a reason. Every change is audited.
- **Commission engine:** applies 0% at capture during the window and the normal fee rules outside it. Never retroactive.
- **Business portal:** a banner on the finance page with the end date, days left and the rate that follows.
- **Notices:** in-app and email, in English and Arabic, 7 days and 1 day before the offer ends.
- **Also in place:** onboarding and verification, catalog, bookings, checkout, refunds, payouts, reviews, support tickets, the usage card for free-tier limits, and the browser smoke tests.

## 3. Before launch (go / no-go gates)

All must be true, each with evidence, before the founder is asked for the go-ahead. The full list is in the [launch checklist](LAUNCH_CHECKLIST.md).

1. Staging deployed and its checks passed (needs the founder's approval to deploy, and the accounts in the [setup guide](FOUNDER_SETUP_GUIDE.md)).
2. A real malware scanner is running (ADR-0032). Without it, business documents cannot be accepted.
3. The founder approves the list of 30 product and 20 service businesses, by name.
4. Each business is verified and approved in the admin console, then its offer is recorded with the founder's approval reference.
5. The founder decides whether the pilot may run on draft legal documents (shown as drafts, with acceptance recorded), and whether payments are live or test mode.
6. Support rota staffed for 9 AM–9 PM and the incident procedure agreed.
7. Daily encrypted backup running and one restore drill passed on staging.
8. The usage card shows every free-tier limit below 80%.
9. Real-device testing done if customers use the mobile apps (otherwise the pilot uses the web build).

## 4. Onboarding a pilot business (operations)

1. Business signs up in the business portal and completes verification (trade licence, owner ID, bank details through Stripe's own onboarding).
2. An operations admin reviews and approves it.
3. A finance admin records the pilot offer on the Pilot page, pasting the founder's approval reference (for example the date and subject of the founder's email). Start: now, or the agreed launch time.
4. The business adds products or services, delivery methods, staff and opening hours, and checks its storefront.
5. Operations confirms the storefront is live and the business appears in the Abu Dhabi listing.

## 5. Running the pilot

- **Daily:** check the admin dashboard (open support tickets, disputes, failed payments, notifications), the usage card, and the Pilot page.
- **Weekly:** review with the founder: enrolment against targets, orders and bookings, gross sales, cancellations and refunds, ticket volume and response times, merchant feedback.
- **Day 23 and day 29:** businesses receive the 7-day and 1-day notices automatically. Operations follows up with any business that asks about the standard rate.
- **Stopping:** if a serious problem appears (payment errors, data exposure, repeated failed deliveries), operations pauses new orders for the affected business (suspension) and the founder decides whether to continue. Ending a business's offer early does not change earlier sales.

## 6. Success measures (proposed; founder to confirm)

| Measure                         | Proposed target                                      |
| ------------------------------- | ---------------------------------------------------- |
| Businesses live                 | 30 product and 20 service businesses by day 7        |
| Businesses with at least 1 sale | 70% by day 30                                        |
| Orders and bookings completed   | No target set; reported weekly                       |
| Payment and ledger accuracy     | Zero unexplained differences in daily reconciliation |
| Support first response          | 95% within 24 hours                                  |
| Serious incidents               | None involving payments or personal data             |
| Merchant intent to stay at 10%  | Asked at the end; reported to the founder            |

## 7. After the pilot

- Each business moves to the standard rate automatically at the end of its own 30 days.
- A pilot report for the founder: the measures above, merchant feedback, problems found and fixes, and the decision needed on a wider launch.
- Production still needs every item in the checklist's production section, including the lawyer, the tax adviser and Stripe's approval for live payments.
