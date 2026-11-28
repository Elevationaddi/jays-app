# ADR-0027: No-show refunds, home-visit travel status and non-commissionable amounts

Status: Accepted (technical design). The home-visit cancellation rule itself stays **proposed** until it is reviewed for UAE consumer protection (ADR-0025). The policy values are the merchant's (D7).

Date: 2026-11-28

## Context

D7 asks for a configurable late-cancellation and no-show policy shown before payment. ADR-0025 adds a travel status for home visits, a full travel-fee refund before travel starts, and per-component amounts so that a travel-fee refund reverses no commission. Until now a no-show refunded nothing and every refund returned commission in proportion to the whole gross, travel fee and delivery charge included.

## Decision

1. **No-show share.** Each service has `no_show_refund_bps` (0 to 100%, default 0). It is snapshotted on the booking with the cancellation policy. Marking a prepaid booking as a no-show refunds that share of the price, rounded down. Bookings made before this change have no value in their snapshot and refund nothing, as before.
2. **Policy before payment.** The booking page and the appointment show the cutoff, the late share, the no-show share and, for a home visit, the travel-fee rule.
3. **Travel status.** A home booking has `travel_status` (`not_started`, `on_the_way`, `arrived`), required for home visits and absent for venue bookings.
   - It moves forward one step at a time on a confirmed booking (arrived also after check-in). "On the way" can be recorded from 3 hours before the start, so it cannot be set early to keep the travel fee.
   - A scheduler may record it for any visit; a professional only for their own.
   - Every step is written to the append-only `booking_travel_events` (time and actor) and audited. The customer gets `booking.travel_started`.
4. **Travel fee on cancellation.** A late customer cancellation refunds the travel fee in full while travel has not started; once it has, the travel fee follows the late share like the service. A business cancellation refunds everything.
5. **Non-commissionable amounts.**
   - An earning records `non_commissionable_fils`: the booking's travel fee or the order's delivery charge, VAT included. Earnings captured before ADR-0025 (commission charged on the travel fee) are capped at the part of the gross outside the commission base, so their refunds still return that commission.
   - A refund records the travel or delivery part it takes (`refunds.non_commissionable_fils`). Booking refunds name it; returns name zero (items only). When the caller cannot say (an admin refund of an amount, a chargeback), it is NULL and the earning's own mix applies.
   - `allocateRefund` returns commission only on the commissionable part, in proportion to the commissionable gross; the refund that empties the commissionable part returns all remaining commission, so rounding never strands a fils.
6. **Per-component amounts.** A single appointment in the business portal shows the service, add-ons, travel fee, VAT included, refunds, commission, VAT on commission, the payment processing fee and what the business receives. The processing fee is shown as pending until the provider is connected (phase 9); discounts are zero until promotions exist.

## Consequences

- A partial admin refund of an order with delivery now returns commission in proportion to the commissionable share, which is the same result as before for refunds that mirror the order's mix.
- No new external service is used.
