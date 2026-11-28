# ADR-0015: Ledger, refunds, payouts and reconciliation

Status: Accepted (engineering). Commercial and legal choices below are assumptions that need founder approval (ADR-0007 D2, D3, D4, D5, D6). They are listed under "Assumptions needing founder approval".

Date: 2026-11-28

## Context

Phase 5 has to turn payments into money that businesses are owed and then pay it out. It also has to cover refunds and disputes, and prove every day that our records agree with the payment provider's. The spec requires:

- a balanced ledger that never loses or double-counts money (T06);
- partial refunds that can never exceed what was paid, and an open dispute that blocks payout (T09);
- fees fixed at payment time even when rules change later (T13);
- reconciliation that recovers lost webhooks (T15);
- a second approver for large refunds (T16).

The founders have not chosen a PSP (D5), the merchant-of-record model (D3) or commission rates (D2). CLAUDE.md says to build against mock adapters and record assumptions rather than wait. So the real-provider work is the only part of phase 5 still outstanding.

## Decision

**Fee rules.** `fee_rules` hold commission in basis points per mode (`shop`, `services`), either for the whole platform or for one business, with an `effective_at`.

- The table is append-only: a trigger refuses UPDATE and DELETE, and a new rule cannot take effect in the past (`EFFECTIVE_IN_PAST`).
- The rule in force at payment time is used, and a business rule beats the platform rule.
- If no rule is in force, commission is 0. No rate is assumed.

**Finance settings.** These are versioned and effective-dated the same way:

| Setting                          | Default          |
| -------------------------------- | ---------------- |
| `refund_approval_threshold_fils` | 50,000 (AED 500) |
| `payout_dispute_window_days`     | 7                |
| `payout_minimum_fils`            | 0                |

**Earnings (T13).** When a payment succeeds, each seller gets one `merchant_earnings` row: one per suborder for an order, one for a booking. The row stores:

- the gross amount;
- the commission rate (bps) and the commission amount, rounded half-up;
- refunded amounts, both gross and commission.

The commission base is the goods subtotal less discounts. Delivery fees go to the seller in full. For a booking, the base is the full price. Later rule changes never touch an existing earning.

**Ledger (T06).** Every money movement is a double-entry transaction:

- `ledger_transactions` hold one row per (kind, source type, source id). That unique key makes every posting idempotent, so a duplicated or replayed webhook posts nothing new.
- `ledger_entries` are the debit and credit lines. The accounts are `psp_clearing`, `merchant_payable` (per business), `payouts_in_transit` (per business), `platform_commission` and `unallocated_receipts`.

The database enforces the invariants:

- Both tables are append-only.
- Each entry is either a debit or a credit, never both.
- Business accounts must carry a business id.
- A deferred constraint trigger refuses to commit any transaction whose debits and credits differ.

The postings are:

- **Capture:** debit clearing for the paid amount, credit the business with the net amount and the platform with the commission.
- **Refund or lost dispute:** the reverse, with commission returned in proportion to the share refunded. The rate is copied onto the earning, so the reversal always uses the original rate.
- **Payout:** sent moves money from the business payable account to in-transit. Paid moves it from in-transit to clearing. Failed moves it back from in-transit to the business.
- **Late payment:** a payment that succeeds after its order or hold expired is auto-refunded (phase 3/4 behaviour). It goes to `unallocated_receipts` and comes back out when the refund succeeds.

**Refunds (T09, T16).**

- Admins with `finance.refund` (finance, support, superadmin) raise a refund request against a payment. For an order, the request names the seller's suborder.
- A request at or below the threshold is issued at once.
- A request above it waits for a second admin. The API refuses approval by the requester (403 `SAME_APPROVER`), and a CHECK constraint makes the database refuse it too. The requester can withdraw the request.
- Several partial refunds are allowed. The trigger `refunds_within_capture` caps the sum of non-failed refunds at the amount paid (422 `REFUND_EXCEEDS_CAPTURE`).
- The ledger posts a refund only when the provider's `refund.succeeded` webhook arrives, never when the refund is requested.

**Disputes and holds.**

- An open dispute keeps its earning out of payouts.
- A won dispute changes nothing.
- A lost dispute posts a chargeback reversal. If the earning was already paid out, the business balance goes negative, and later payouts recover it first.
- A payout hold (one active per business) skips that business in payout runs. Businesses see that payouts are held but not the internal reason.

**Payouts.**

- An earning becomes eligible once the work is done and the dispute window has passed. "Done" means a booking that is completed, a no-show, or cancelled with money kept, or a suborder that is delivered (phase 6 sets `delivered_at`).
- The SQL function `mark_earnings_eligible` does this. The worker runs it every 10 minutes, and it also runs at the start of every payout run.

A payout run is started by an admin with `finance.manage`. For each business it:

1. locks the business row and its eligible earnings `FOR UPDATE`, so two runs cannot pay the same earning twice;
2. skips the business if it is suspended, on hold, has a refund pending on those earnings, owes nothing, or is below the minimum;
3. pays `min(eligible net, ledger payable balance)`, so a negative carry is recovered;
4. asks the provider to pay outside the transaction, with idempotency key `payout-<id>` and our payout id as the reference.

The provider's webhook settles the payout. If the provider refuses, the payout fails visibly, its earnings return to eligible and the ledger reverses.

**Reconciliation (T15).** One run per provider per UTC day, which can be retried if it fails. It compares the day's provider records with ours:

- **Settled at the provider but still open here (a lost webhook):** the event is replayed through the normal webhook path, with a deterministic event id (`recon_<type>_<ref>`). A replay, or a late real webhook, is therefore applied only once. These findings are recorded as resolved automatically.
- **Amount or status differs, or the record is missing on one side:** the run flags it for finance and changes nothing. A finance admin marks each finding handled, with a note.

Mismatches emit an outbox event for alerting. The API runs reconciliation of the previous day hourly (idempotent, off in tests), and admins can run any finished day.

**Access.**

- **Platform:**
  - `finance.view`: finance, support, analyst, compliance and superadmin.
  - `finance.refund`: finance, support and superadmin.
  - `finance.manage`: finance and superadmin. It covers rules, settings, disputes, holds, payout runs and reconciliation.
- **Business:** `finance.view` (owner and finance member). It shows the business's own balance, earnings, payouts and statement, scoped by the existing business access guard.

## Assumptions needing founder approval

- **D2, commission:** no production rate is assumed, so commission is 0 until a rule is added. Local seed data adds a 10 % placeholder platform rule for each mode, labelled as not approved.
- **D3, merchant of record:** the business is the seller. The platform collects on its behalf, keeps commission and pays out the rest.
- **D4, VAT:** no VAT is charged on commission and no invoices are produced yet. Tax-invoice rules depend on D3.
- **D5, PSP:** mock provider only. Production refuses to start with it. The adapter interface (`createPayout`, `listRecords`, signed webhooks with references) is what a real provider must implement.
- **D6, payout timing:** 7-day dispute window and no minimum, both changeable in the admin console. Payouts are run by an admin, not on a schedule.
- **Bank details:** not collected yet. The provider is assumed to hold each business's payout destination, as marketplace PSPs do.
- **Commission refunds:** commission is refunded in proportion to the refund.
- **Reconciliation:** runs inside the API process. It moves to the worker when the worker gets provider access in phase 7.

## Consequences

The database itself guarantees that the ledger balances, that history cannot be rewritten and that refunds cannot exceed captures. The integration tests insert unbalanced or excessive rows directly and the database refuses them. Postings are idempotent by key, so webhook retries and reconciliation replays are safe.

Switching to a real PSP means writing one adapter and running the same suite against its sandbox. No ledger logic changes.

Payout runs serialize per business, which is fine at pilot scale.
