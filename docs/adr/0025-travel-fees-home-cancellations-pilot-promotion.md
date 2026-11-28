# ADR-0025: Travel fees outside commission, home-visit cancellations and the pilot promotion

Status:

- **Travel fees:** accepted and implemented.
- **Home-visit cancellation policy:** proposed until it is reviewed for UAE consumer protection.
- **Pilot promotion:** accepted as a commercial direction. It is applied only to merchants the founder approves, and the pilot itself is not launched without approval.

Date: 2026-11-28

## Context

The founder's revised decisions of 28 November 2026 change three things set by D2, D9 and D11 (ADR-0018, ADR-0021, ADR-0022).

## Decision

### 1. Travel fees carry no commission (implemented)

- **Commission base:** the standard JAYS commission (10% by default, ADR-0021) is worked out on the eligible service amount before VAT. A separately itemised travel fee is the merchant's in full.
- **Invoices:** the customer invoice keeps the travel fee as its own line, with VAT in proportion (ADR-0022).
- **Refunds:** commission and VAT on commission are still reversed in proportion to the amount refunded.
- **Travel-fee-only refunds** (section 2) will reverse no commission. That needs the per-component amounts below and comes with section 2.
- **Per-component amounts:** each booking will record service price, add-ons (phase 8.7), travel fee, VAT, discounts, platform commission, payment processing fee (from the provider in phase 9) and merchant net. Reports and refunds can then use each part on its own.

### 2. Home-visit cancellations (proposed)

- **Before travel starts:** if the professional has not started travelling, the travel fee is refunded in full whenever the customer cancels. The service part follows the service's cancellation policy.
- **After travel starts:** the disclosed cancellation policy decides whether the business may keep the travel fee.
- **Business cancels:** the customer is refunded in full, travel fee included. This is already the rule for business cancellations.
- **Travel status:** the professional or the business marks "on the way" in the business portal. Each change (`not_started`, `on_the_way`, `arrived`) is recorded with time and actor, and cannot be edited.
- **Policy snapshot:** each booking keeps the cancellation policy shown at payment. A business changing its policy later never changes existing bookings.
- **Before payment:** the policy, including the travel-fee rule, is shown to the customer.
- **Built in:** phase 8.8 (cancellation policies).

### 3. Pilot promotion (accepted direction)

- **Eligibility:** approved pilot merchants pay **0% platform commission for their first 30 days**. Payment processing charges and taxes still apply. Afterwards the default commission (10%) applies.
- **Founder approval:** the founder approves each participating business. An admin with finance rights records the approval, which is audited.
- **Promotion window:** the promotion has a start and end time per business. Approval records two business fee rules up front: 0% from the start and the default rate from the end. Fee rules are append-only and chosen by `effective_at` (ADR-0021), so the move back to 10% happens automatically, with no job to run.
- **Earlier transactions:** the rate in force at capture is snapshotted on each earning (ADR-0021). The promotion never applies retroactively to completed transactions.
- **Notice:** merchants get an in-app notification and an email 7 days and 1 day before the commission changes.
- **Records and reporting:** commission history per business is shown in the business portal and the admin console. Pilot performance is shown on a pilot dashboard (phase 12).
- **Built in:** phase 12 (pilot preparation). The mechanism changed: see [ADR-0034](0034-pilot-promotion.md). Two fee rules would have replaced category rates after the pilot, so the promotion is its own record checked at capture.

## Consequences

- ADR-0022's "commission applies to the whole booking price, travel fee included" is withdrawn.
- ADR-0021's commission engine needs no change for section 1: each line's commission base is computed by the caller, and the booking line now leaves the travel fee out.
