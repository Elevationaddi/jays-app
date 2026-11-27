# ADR-0014: Services, staff, availability and booking

Status: Accepted (engineering). The policy and scope assumptions below are proposed defaults that need founder approval (ADR-0007 D7, D9).

Date: 2026-11-27

## Context

Phase 4 adds bookable services. The spec requires that one professional can never be booked twice for overlapping time, even under concurrent requests (T07, T08). It also requires that a held slot is released if payment does not arrive, and that a booking keeps the price and policy it was sold with (T13). Times must be correct across the Dubai day boundary and in zones with daylight saving (T14), and cancellation refunds must follow the policy exactly at the cutoff (T09). No payment provider has been chosen (D5).

## Decision

**Schedule data.** A business has branches with weekly opening hours (one interval a day in the UI; the API accepts several non-overlapping intervals) and dated closures. Services belong to the business, are offered at chosen branches and carry duration, buffers before and after, price, tax class and cancellation policy. Staff profiles work at chosen branches, perform chosen services, may be linked to a team membership and have weekly shifts per branch plus dated blocks (break, leave, other). Hours and shifts are local wall-clock times in the branch's IANA time zone (default `Asia/Dubai`). Every instant (bookings, closures, blocks) is stored in UTC.

**Availability.** `availableSlots` in `packages/domain` is a pure function. It walks a 15-minute grid from opening to closing and keeps a start when the service plus buffers fits inside branch hours and a staff shift, and misses closures, blocks and every held, confirmed or checked-in booking of that professional. Buffers count as occupied time for the professional but are not shown to the customer. The API loads one local day per request and returns each start with the staff who can take it.

**No double booking.** Each booking stores `occupied_start` and `occupied_end` (the visit plus buffers). A Postgres exclusion constraint `bookings_no_overlap` (btree_gist) forbids overlapping `tstzrange(occupied_start, occupied_end, '[)')` for the same `staff_id` while the status is held, confirmed or checked_in. Allocation runs in one transaction:

1. It expires overdue holds.
2. It takes share locks on the branch and staff rows, so a concurrent schedule edit waits.
3. It recomputes availability and requires the requested start to be an offered slot.
4. It tries each candidate professional in a savepoint, catching exclusion violations (23P01) and moving on.

"Any professional" ranks candidates deterministically, by fewest bookings that day and then by id. A preferred professional is tried first. If every candidate fails, the API returns 409 `SLOT_UNAVAILABLE`. The constraint, not the application check, is the final guard.

**Schedule edits cannot strand bookings.** Editing hours, closures, shifts, blocks, staff branches or services locks the branch or staff row `FOR UPDATE`. It then re-checks every future booking with `fitsSchedule`. A conflict returns 409 `SCHEDULE_CONFLICT` listing the affected booking ids, and the merchant must move or cancel those bookings first.

**Holds and payment.** `POST /bookings/hold` needs an `Idempotency-Key`. It creates a `held` booking that expires after 10 minutes. A customer may have at most 2 open holds (`HOLD_LIMIT`) and may book up to 60 days ahead. Payment reuses the phase 3 `PaymentProvider` with idempotency key `booking-<id>`. Only a verified webhook confirms a booking. A success after the hold expired refunds in full and the booking stays expired. A failure releases the slot at once. The worker runs `expire_booking_holds` every 30 seconds, the same SQL function the API calls before allocating.

**Snapshots.** Each booking stores a `snapshot` (business, branch, service with durations and price, staff) and a `policy_snapshot` (cutoff hours, late refund basis points). Later service edits never change an existing booking's price, duration or refund.

**Cancellation and reschedule.**

- **Customer cancellation:** before the cutoff, the refund is 100 %. At or after the cutoff, the refund is `lateCancelRefundBps` of the price, rounded half-up to whole fils. After the start time, the customer cannot cancel.
- **Business cancellation:** a prepaid booking is refunded in full.
- **Refund processing:** refunds are requested inside the transaction and sent to the provider after commit. A refund webhook marks the payment refunded or partially refunded.
- **Reschedule:** the customer moves a confirmed booking with an in-place update, so the old slot is never released before the new one is held. The exclusion constraint still applies.

**Merchant calendar.** A day view per branch with check-in, complete, no-show and cancel actions. Each action carries the booking version the user saw, so stale actions get 409. Merchants can also add phone and walk-in bookings, which are confirmed at once and paid at the venue. Professionals with `appointments.view_own` see only bookings for the staff profile linked to their membership.

**Access.** The business capability `services.manage` (owner, manager) covers branches, services and staff. The platform capability `bookings.view` lets support, operations, compliance and superadmin monitor bookings. `services.takedown` lets catalog, operations, compliance and superadmin suspend and reinstate a service, with a reason, a version precondition and an audit entry.

## Assumptions needing founder approval

- **No pre-approval:** services and branches go live without admin pre-approval once the business and its services mode are approved. Admins can suspend a service at any time. This differs from products, which are reviewed before going live.
- **D7, cancellation policy:** each merchant sets it per service. The defaults are a 24-hour cutoff and 0 % refund after the cutoff. The platform sets no minimum.
- **D9:** services happen in the venue only. Home visits are out of scope.
- **Manual bookings:** they are recorded as paid at the venue, with no online payment, and must start in the future.
- **Rescheduling:** only customers can reschedule in the app. Merchants cancel and rebook.
- **Payments:** they use the mock provider (D5). Production refuses to start with it.

## Deferred

The following are deferred:

- Deposits and partial prepayment.
- Packages and memberships.
- Group classes.
- Waitlists.
- Reminders (phase 6 notifications).
- Reviews (phase 6).
- Merchant-side reschedule.
- More than one shift per day in the portal UI (the API already accepts several).
- Payouts and ledger entries for booking revenue (phase 5).

## Consequences

The database itself guarantees that a professional can never be double-booked, and the integration tests fire real concurrent holds at Postgres to prove it. Schedule edits and allocations serialize on the branch and staff rows, which only affects the same venue at the same moment. Availability is computed per request with no cache. That is simple and always fresh, and it is fast enough for venue-sized schedules. A cache can come later if load tests show a need.
