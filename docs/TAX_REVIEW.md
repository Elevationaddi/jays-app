# Tax review (for a UAE tax professional)

> **Status: not reviewed.** No tax adviser has been appointed. JAYS's tax registration number (TRN) is **not confirmed**, and no merchant is assumed to be VAT registered. Production tax rules are **off**: every tax document carries `rules_approved = false` and is shown as a draft, from the code constant `TAX_RULES_APPROVED = false` (`packages/domain/src/finance.ts`). This document describes what the software does today and lists the questions the adviser must answer. It is not tax advice.

Prepared: 2026-11-28 · Related: ADR-0018 (D2–D4, D6), ADR-0021, ADR-0025, ADR-0027, `docs/legal/LEGAL_REVIEW_CHECKLIST.md`

## 1. The business model in brief

- JAYS is an online marketplace in the UAE for products (beauty, wellness and related goods) and appointments (in a salon or at the customer's home).
- **Businesses are the sellers.** JAYS is a disclosed intermediary and not the merchant of record (D3). The customer pays the full price through JAYS's payment provider (Stripe Connect in test mode; live payments are not active). The provider holds the funds for the seller; JAYS takes its commission and pays the seller weekly, 7 days after delivery or completion (D6).
- **Commission** (D2): 10% by default, configurable per business, category and transaction type. It is charged on the amount **before VAT** and never on delivery charges or home-visit travel fees (ADR-0025, ADR-0027). The rate is fixed at the time of the transaction.
- **Pilot promotion** (ADR-0025): 0% commission for each pilot merchant's first 30 days, then 10%. Not yet built (phase 12).
- **Currency and rounding:** AED, stored as integer fils. Prices are VAT-inclusive. VAT and commission are rounded half-up per line.

## 2. What the software does today

| Area                            | Behaviour                                                                                                                                                                                                 | Where          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Seller VAT registration         | Each business records `tax_registered` and a 15-digit TRN at onboarding. Finance admins can record a change later (audited); it applies to later sales only.                                              | ADR-0021 §3    |
| VAT on sales                    | Prices are VAT-inclusive at the standard rate configured (`vat_bps`, 5% default). An unregistered seller charges no VAT; the customer pays the same price.                                                | ADR-0021 §3    |
| VAT on delivery and travel fees | Follows the seller's registration, like the goods or service.                                                                                                                                             | ADR-0021, 0025 |
| Commission base                 | Price before VAT; excludes delivery and travel fees.                                                                                                                                                      | ADR-0021 §2    |
| VAT on commission               | Charged to the seller only when the platform setting `platform_vat_registered` is on (off by default). It cannot be turned on until a platform TRN is set in code. Rate `commission_vat_bps`, 5% default. | ADR-0021 §4    |
| Documents on payment            | (a) An invoice from the seller to the customer (a tax invoice when the seller is registered), with lines, delivery or travel fee, and VAT; (b) a commission invoice from JAYS to the seller.              | ADR-0021 §5    |
| Documents on refund             | A credit note from the seller to the customer (VAT in proportion; the last one takes the remainder) and a commission credit note. A travel-fee refund returns no commission (ADR-0027).                   | ADR-0021, 0027 |
| Numbering                       | Per issuer and UAE calendar year: `INV-2026-000001`, `CRN-…`, `JCI-…`, `JCC-…`, from a locked sequence. Documents are append-only.                                                                        | ADR-0021 §5    |
| Snapshots                       | Seller and buyer details are copied onto each document at issue.                                                                                                                                          | ADR-0021 §5    |
| Reports                         | Admins see a VAT report for a period of UAE dates: platform VAT on commission, and each seller's invoiced and credited totals.                                                                            | ADR-0021 §6    |
| Payment processing fees         | Not yet known: shown as pending until the provider is connected (phase 9). Who bears them is an open founder question.                                                                                    | ADR-0027 §6    |
| Draft flag                      | Every document stores `rules_approved` from `TAX_RULES_APPROVED = false` and is labelled as a draft.                                                                                                      | ADR-0021 §5    |

Everything above is configurable or isolated so the adviser's answers can be applied without rewriting the ledger: rates are settings, registration is per business and per platform, and the document issuer and wording are in one service.

## 3. Questions for the adviser

Legend: **B** = blocks taking real payments in the pilot · **L** = before a wider launch · **I** = improvement.

### 3.1 JAYS's own position

| #     | Question                                                                                                                                                                | Priority |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3.1.1 | Must JAYS register for VAT now (mandatory threshold) or may it register voluntarily? From when? What is its TRN?                                                        | B        |
| 3.1.2 | Under the disclosed-agent model, is JAYS's taxable supply only the commission (and any fees), not the goods or services? What evidence or wording keeps that treatment? | B        |
| 3.1.3 | Is commission charged to sellers a standard-rated supply at 5%? Any difference for sellers in free zones?                                                               | B        |
| 3.1.4 | Does the 0% pilot commission create any VAT or documentation consequence (for example a zero-value commission invoice, or none)?                                        | B        |
| 3.1.5 | Corporate tax: is JAYS's income its commission only? Any registration, filing or transfer-pricing points for the founder to plan for?                                   | L        |

### 3.2 Documents

| #     | Question                                                                                                                                                                                                                | Priority |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3.2.1 | Who must issue the customer's tax invoice: the seller, or JAYS on the seller's behalf? Is self-billing or issuing in the seller's name allowed, and on what conditions?                                                 | B        |
| 3.2.2 | Which fields are mandatory on a tax invoice, a simplified tax invoice, a credit note and the commission invoice? Are Arabic text or particular titles required?                                                         | B        |
| 3.2.3 | What does an unregistered seller's customer document need to say (and must it avoid the words "tax invoice")?                                                                                                           | B        |
| 3.2.4 | Is per-issuer, per-year numbering acceptable? Are there sequence or gap rules?                                                                                                                                          | B        |
| 3.2.5 | Does the UAE e-invoicing programme apply to JAYS or its sellers, from when, and what would change (format, accredited provider, timelines)? Any accredited provider must be free or approved by the founder before use. | L        |
| 3.2.6 | How long must documents and records be kept, and may they be stored outside the UAE?                                                                                                                                    | L        |

### 3.3 Specific transactions

| #     | Question                                                                                                                                             | Priority |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3.3.1 | Delivery charged by the seller: same VAT treatment as the goods? Any difference when the seller uses a third-party courier?                          | B        |
| 3.3.2 | Home-visit travel fees: part of the service supply for VAT? Is excluding them from commission acceptable for JAYS's own VAT?                         | B        |
| 3.3.3 | Late-cancellation and no-show fees kept by a seller: are they consideration for a supply (VAT due) or compensation (outside scope)? Partial refunds? | B        |
| 3.3.4 | Returns and partial refunds: is the proportional VAT on credit notes correct?                                                                        | B        |
| 3.3.5 | Chargebacks lost by the seller: is a credit note right, or a different adjustment?                                                                   | L        |
| 3.3.6 | Discounts and promotions funded by the seller (and, later, by JAYS): how should they appear on documents and in the VAT base?                        | L        |
| 3.3.7 | Payment processing fees: if passed to the seller, is that a separate supply by JAYS (VAT) or a disbursement?                                         | B        |
| 3.3.8 | Payouts and timing: is there any tax point issue between the customer's payment, completion and the weekly payout?                                   | L        |
| 3.3.9 | Rounding: is half-up per line, then summing, acceptable? Or must VAT be computed on the invoice total?                                               | B        |

### 3.4 Reporting

| #     | Question                                                                                                                                                                          | Priority |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3.4.1 | Is the admin VAT report sufficient for JAYS's own return? What else is needed (boxes, emirate split)?                                                                             | L        |
| 3.4.2 | Should sellers get a periodic statement from JAYS to support their returns? What should it show?                                                                                  | L        |
| 3.4.3 | Must the emirate of supply be recorded per transaction for VAT returns? (Customer address emirate is stored for deliveries and home visits; venue emirate for in-salon bookings.) | B        |

## 4. What happens after the review

1. Engineering applies the answers as configuration or code changes with tests and an ADR.
2. The founder records the review in an ADR and decides whether to set `TAX_RULES_APPROVED = true`. Documents issued before that keep `rules_approved = false`.
3. The platform TRN is set in code (`PLATFORM_TRN`) only after JAYS is registered. Never use a placeholder or someone else's TRN.

## Sign-off

| Item                                           | Name | Date | Notes |
| ---------------------------------------------- | ---- | ---- | ----- |
| Tax adviser appointed                          |      |      |       |
| Review complete for the pilot (B)              |      |      |       |
| Review complete for wider launch (L)           |      |      |       |
| Founder authorizes `TAX_RULES_APPROVED = true` |      |      |       |
