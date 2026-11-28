# ADR-0021: Commission by category, VAT, tax documents and weekly payouts

Status: Accepted (technical design). The commission rates, the VAT treatment and the document wording are **proposed**. They need commercial approval (D2) and approval by a UAE tax professional (D4). Every document is marked as a draft until then. Nothing here switches on a production tax rule.

Date: 2026-11-28

## Context

Several founder decisions (ADR-0018) apply here:

- **D2 (commission):** a default 10% commission, with overrides by business, category and transaction type. No commission is charged on VAT or delivery, and the rate is snapshotted at the time of the transaction.
- **D3 (who sells):** businesses are the sellers, and JAYS is a disclosed intermediary, not the merchant of record.
- **D4 (VAT):** VAT is configurable by merchant and platform registration. It requires the merchant's TRN, customer invoices, commission invoices, credit notes and VAT reporting.
- **D6 (payouts):** weekly payouts, 7 days after delivery or completion.

ADR-0015 calculated commission on the VAT-inclusive goods total, kept no tax documents, and only ran payouts when an admin started them.

## Decision

1. **Commission rules gain a category (D2).**
   - `fee_rules.category_id` sits alongside the mode (transaction type: product sale or booking) and the business.
   - The most specific rule wins: business and category, then business, then category, then the platform rate. A category rule also covers that category's subcategories, and the nearest category wins.
   - A rule's category must be of the same mode as the rule.
2. **Commission is worked out per line, on the amount before VAT.** Delivery carries no commission.
   - Each line's rule, rate, base and commission are copied onto the earning in `commission_detail`.
   - The earning's rate is the single rule's rate, or the blended rate when lines differ.
   - Later rule changes never touch an earning (T13).
   - Refunds return commission in proportion, as before.
3. **VAT follows registration (D4).**
   - Prices stay VAT-inclusive. A seller that is not VAT registered charges no VAT: its lines and delivery carry none, and the customer pays the same price.
   - Registration is the existing `tax_registered` and TRN (`tax_id`) captured at onboarding. Finance admins can record a change later (`PUT /admin/finance/businesses/:id/tax`, audited), and it applies to sales from then on.
4. **VAT on commission** is charged to the seller only when the platform is VAT registered.
   - That is the finance setting `platform_vat_registered`, which is off by default. Turning it on is refused until the platform's TRN is set in code (`PLATFORM_TRN`), so no invoice can show VAT without a number.
   - The rate is `commission_vat_bps`, 5% by default.
   - The VAT is kept on the earning, posted to a new ledger account `platform_output_vat`, returned in proportion with refunds, and taken out of the seller's net.
5. **Tax documents (D3).** The documents are written when money moves, in the same database transaction:
   - **On payment:**
     - an invoice from the seller to the customer (a _tax invoice_ when the seller is registered), with each line, delivery and VAT;
     - a commission invoice from JAYS to the seller.
   - **On a refund or lost dispute:**
     - a credit note from the seller to the customer, whose VAT is the invoice's VAT in proportion, with the last credit note taking what is left;
     - a commission credit note.
   - **Numbering:** documents are numbered per issuer and UAE year (`INV-2026-000001`, `CRN-…`, `JCI-…`, `JCC-…`) from a locked sequence row.
   - **Snapshots:** seller and buyer details are snapshotted.
   - **No edits:** documents are append-only, one per kind and source.
   - **Draft flag:** each document stores `rules_approved`, taken from the code constant `TAX_RULES_APPROVED = false`. Changing that is a founder decision recorded in an ADR, not a setting.
6. **Who sees which documents:**
   - Customers see their invoices and credit notes on the order or appointment.
   - Businesses see theirs and JAYS's commission documents.
   - Admins see all documents, plus a VAT report for a period of UAE dates. The report has the platform's VAT on commission and each seller's invoiced and credited totals for its own return.
7. **Weekly payouts (D6).**
   - The finance scheduler runs a payout run once a week, on `payout_weekday` (Monday by default) after 06:00 UAE time.
   - A unique `payout_runs` row per day makes several API instances or hourly ticks run it once.
   - Eligibility, holds, open disputes, pending refunds and negative balances are applied by the run, as in ADR-0015. Admins can still run payouts by hand.
   - Payouts go through the provider adapter, so there is no internal escrow.
8. **Test isolation.** Integration files share one database. The reconciliation test, whose clock is a day ahead, expired other files' fresh holds whenever it created a hold, which caused occasional failures. That test and the weekly payout test now run in a second group, after the rest.

## Consequences

- Commission figures in earlier tests change, because commission no longer includes VAT. For example, a 105.00 appointment now pays 10.00 commission, not 10.50.
- Test sellers are VAT registered with a fictional TRN. Local seed sellers are not VAT registered unless an admin records it.
- Phase 9 should confirm with Stripe how Connect application fees map to the commission and its VAT.
- Subscriptions, featured listings and sponsored placements are not built. The fee rule model and commission documents can take new transaction types later.
- **Open for a UAE tax professional:**
  - whether the seller or JAYS should issue customer tax invoices under the disclosed-agent model;
  - the wording and fields required on each document;
  - VAT on delivery charged by sellers;
  - whether commission VAT applies at the standard rate;
  - rounding (half-up per line).
