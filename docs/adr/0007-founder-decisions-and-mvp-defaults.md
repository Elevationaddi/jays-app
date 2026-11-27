# ADR-0007: Founder decisions and MVP defaults

- Status: **Proposed. Nothing in this record is approved.**
- Date: 2026-11-27

## Context

`docs/10-build-plan.md` lists decisions that need founder approval before production and proposes MVP defaults. Engineering can proceed through phases 0–4 using configurable values and mocks, but must not hard-code any of these as if they were policy.

## Decisions requiring founder approval

| #   | Decision                                                                       | Needed before                        | Current engineering assumption                                                                   |
| --- | ------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| D1  | Brand and product name                                                         | Public UI, app store                 | Neutral working name "Marketplace"; package scope `@jays`; plum/charcoal palette marked proposed |
| D2  | Commission rates (product and service) and subscription rates                  | Phase 5 ledger go-live               | Effective-dated `fee_rules` in basis points; no rate assumed                                     |
| D3  | Merchant of record (platform vs business)                                      | Phase 5                              | Business is seller/provider (spec default), pending legal review                                 |
| D4  | VAT and invoice handling, rounding policy                                      | Phase 5                              | Tax class per variant; rounding mode must be passed explicitly (ADR-0005)                        |
| D5  | Payment service provider (must support UAE marketplace onboarding and payouts) | Phase 5                              | Mock PSP adapter only; production refuses mock                                                   |
| D6  | Payout delay and dispute window                                                | Phase 5                              | Configurable; payouts blocked while a dispute is open                                            |
| D7  | Return and cancellation windows, no-show policy                                | Phases 3–4 for UI, launch for values | Versioned policy records; values configurable per business                                       |
| D8  | Delivery partners and zones                                                    | Phase 3 checkout                     | Merchant delivery with merchant-defined zones and fees                                           |
| D9  | Home services supported?                                                       | Phase 4                              | No: in-venue only                                                                                |
| D10 | Regulated service categories                                                   | Phase 2 taxonomy                     | Medical procedures excluded                                                                      |
| D11 | Operating emirates                                                             | Phase 1 welcome screen               | All seven emirates selectable, controlled by admin settings                                      |
| D12 | Support hours                                                                  | Phase 6                              | Configurable; not displayed until set                                                            |

## MVP defaults assumed (from the spec, also unapproved)

In-venue services only; prepaid appointments; merchant-arranged delivery; no subscriptions; no cash on delivery; one service per booking; no medical services; no platform-held wallet or escrow.

## Launch gates outside engineering

UAE marketplace and merchant licence activities, Arabic consumer disclosures, seller identity and invoice obligations, cosmetics/perfume registration and labelling, venue permissions, UAE personal data rules and cross-border processing, VAT agency/principal treatment, PSP marketplace approval and payout terms (`docs/09-security-testing.md`). These need legal counsel and an accountant; nothing in this codebase implies compliance.

## Consequences

- Phase 5 cannot start its real-provider work until D3 and D5 are decided.
- Production deploy is blocked until every row above is approved and recorded here with date and approver.
