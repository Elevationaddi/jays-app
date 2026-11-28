# Founder decision register

The single list of the founder's decisions and what each one still needs. Details live in the linked ADRs.

**Status values:**

- **Approved:** the founder decided, and engineering builds it.
- **Proposed:** built behind configuration and not active in production until the named sign-off.
- **Blocked:** cannot be completed under the current constraints without a further decision.

Last updated: 28 November 2026.

## Mandatory constraint

**No paid software subscriptions beyond Vercel, ChatGPT and Claude.** This comes from the founder on 28 November 2026 ([ADR-0024](adr/0024-cost-constraints-and-vercel-first-architecture.md)).

- **Allowed:**
  - free tiers that allow commercial use;
  - open source;
  - the existing Vercel plan within its included usage;
  - free GitHub features;
  - per-transaction payment fees, once approved.
- **Not counted as free:** trials.
- **Never without explicit founder authorisation:**
  - registering, buying, activating or upgrading a paid service;
  - switching on pay-as-you-go or overages.

Where a requirement cannot be met within this rule, the blocker and the alternatives are documented and other work continues. Security, payment integrity, data protection and financial accuracy are never reduced to save cost.

## Decisions

| #    | Topic                    | Decision                                                                                                                                                                        | Status                      | Still needed                                                      | ADR        |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- | ---------- |
| D1   | Brand                    | Working name JAYS, configurable                                                                                                                                                 | Approved                    | Final brand, trademark                                            | 0018       |
| D2   | Commission               | Free registration; 10% default on products and services; overrides by business, category and type; none on VAT, delivery or **travel fees**; rate snapshotted                   | Approved (rates commercial) | —                                                                 | 0021, 0025 |
| D3   | Structure                | Businesses are the sellers; JAYS is a disclosed intermediary, not merchant of record                                                                                            | Proposed                    | Legal and Stripe approval                                         | 0018       |
| D4   | VAT                      | Configurable by merchant and platform registration. JAYS's TRN is **not confirmed**, and no merchant is assumed to be registered                                                | Proposed                    | UAE tax adviser (none appointed); tax review document (phase 8.8) | 0021       |
| D5   | Payments                 | Stripe Connect, test mode only. Prefer the configuration with no monthly platform or connected-account fee                                                                      | Proposed                    | Stripe UAE approval; founder approval of fees; no live payments   | 0024       |
| D6   | Payouts                  | 7 days after delivery or completion; weekly; provider infrastructure                                                                                                            | Approved                    | Stripe confirmation                                               | 0021       |
| D7   | Returns, cancellations   | 14-day returns with exclusions; free cancellation up to 24 h; policies shown before payment and snapshotted                                                                     | Proposed                    | Legal review                                                      | 0016       |
| D8   | Delivery                 | Merchant-managed delivery; zones, fees, tracking links; optional logistics adapter, no paid partner at launch                                                                   | Approved                    | —                                                                 | 0013       |
| D9   | Home services            | Venue, home or both; coverage, travel fee, minimum, buffers; licence and admin approval                                                                                         | Approved                    | Licence rules per emirate (legal)                                 | 0022       |
| D9a  | Home-visit cancellations | Travel fee refunded if travel has not started; afterwards the disclosed policy decides; business cancels means full refund; travel status recorded                              | Proposed                    | UAE consumer-protection review                                    | 0025       |
| D10  | Categories               | No medical or clinical services                                                                                                                                                 | Approved                    | —                                                                 | 0020       |
| D11  | Locations                | All seven emirates; pilot in Abu Dhabi                                                                                                                                          | Approved                    | Pilot go-ahead                                                    | 0020       |
| D11a | Pilot                    | 30 product and 20 service businesses for 30 days; the founder approves each business; **0% commission for each approved merchant's first 30 days**, then 10%; never retroactive | Approved direction          | Founder's list of businesses; launch approval                     | 0025, 0034 |
| D12  | Support                  | 9 AM–9 PM, first response within 24 h                                                                                                                                           | Approved                    | —                                                                 | 0020       |
| D13  | Legal documents          | Drafts only, versioned, with acceptance records. **No lawyer appointed**                                                                                                        | Proposed                    | Lawyer; legal review checklist covering all seven emirates        | 0018       |
| D14  | Notifications            | Resend Free for email, Firebase Cloud Messaging for push, in-app notifications. **No SMS, no Twilio**                                                                           | Approved                    | Founder creates accounts (setup guide)                            | 0024       |
| D15  | Marketing consent        | Granular, recorded, withdrawable                                                                                                                                                | Approved                    | Legal wording                                                     | 0019       |
| H1   | Hosting                  | Vercel-first (customer web, business, admin, API; staging and production). **No AWS**                                                                                           | Approved                    | Deployment approval                                               | 0024       |
| H2   | Database and storage     | Supabase Free (PostgreSQL and private storage). Kysely and SQL migrations unchanged                                                                                             | Approved                    | Free-tier limits; data residency (no UAE region)                  | 0024       |
| H3   | Search, analytics, jobs  | PostgreSQL search; built-in dashboards; database outbox with Vercel Cron. No paid search, analytics, queue or Redis                                                             | Approved                    | —                                                                 | 0024       |
| H4   | Malware scanning         | Open-source ClamAV if it can be hosted within the rules; otherwise a production blocker                                                                                         | **Blocked** for production  | Founder choice of scanner hosting                                 | 0024       |

## Superseded

- **AWS:** hosting, RDS, S3 and Secrets Manager (ADR-0017, ADR-0018). Replaced by ADR-0024.
- **Twilio and SMS** (D14 in ADR-0018). Replaced by ADR-0024.
- **Commission on travel fees** (ADR-0022). Replaced by ADR-0025.
