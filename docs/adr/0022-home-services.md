# ADR-0022: Home services

Status: Accepted (technical design). The licence requirement, travel fees, minimums and coverage are the merchant's own terms under D9. Which licence a home-service business needs in each emirate is a **legal question that is still open**: the platform records and reviews the licence the business uploads, but does not decide which authority must issue it.

Date: 2026-11-28

## Context

Founder decision D9 (ADR-0018): services can be offered at the venue, at the customer's home, or both. Home visits need coverage areas, a travel fee, a minimum amount and travel buffers. Visits must never overlap, travel included. A business needs a licence and admin approval before it can offer home visits.

Phase 4 (ADR-0014) assumed in-venue services only. A booking's `occupied_*` interval (the appointment plus the service's buffers) is covered by the `bookings_no_overlap` exclusion constraint, which makes double booking impossible.

## Decision

1. **Where a service happens.** `services.location_mode` is `in_venue` (the default), `home` or `both`. A business can choose `home` or `both` only once its home-service profile is approved (409 `HOME_SERVICES_NOT_APPROVED`). Every service still belongs to at least one branch: the branch is where the professional's shifts are kept, and its opening hours bound the appointment times.
2. **Home-service profile, one per business** (`home_service_profiles`), holding:
   - the licence: number, issuing authority, expiry date, and a clean uploaded document of the new kind `home_service_license`, which can be uploaded after the business itself was approved;
   - the travel buffer: minutes kept free before and after each visit (0–120, default 30);
   - the minimum service price for a home visit; the travel fee does not count towards it.
3. **Review.** The status moves `draft → pending` when the owner asks for review. Asking needs every licence field, an unexpired licence and at least one area (422 `HOME_PROFILE_INCOMPLETE`).
   - Compliance admins approve or reject a pending profile, and suspend or reinstate an approved one. Rejecting and suspending need a reason, which the business sees. Every decision is audited and queued as a notification.
   - Licence details change only while the profile is a draft or rejected (409 `HOME_PROFILE_LOCKED`). After approval, a new licence goes through support.
   - Travel buffer, minimum and areas can change at any time. They apply to new bookings only.
   - A profile is **active** only when it is approved and its licence has not expired (UAE date). An expired licence stops home bookings without an admin action.
4. **Coverage areas** (`home_service_areas`): an emirate, optionally narrowed to one area, each with its own travel fee. A named area beats the emirate-wide row. Areas compare without case or extra spaces. Areas in an emirate an admin switched off (D11) are not offered.
5. **Booking a home visit.** The customer picks one of their saved addresses (`location: "home"`, `addressId`). The API checks, in order: the profile is active, the service offers home visits, the address is covered, and the service price meets the minimum. It answers 422 `HOME_SERVICES_NOT_AVAILABLE`, `LOCATION_NOT_OFFERED`, `ADDRESS_NOT_COVERED` or `BELOW_HOME_MINIMUM`.
   - The booking stores the address as booked (`home_address`), the travel fee and the travel buffer (T13).
   - The price is the service price plus the travel fee. The travel fee is part of the same supply, so it takes the service's VAT treatment (D4). The invoice shows it as its own line.
   - The travel buffer widens the occupied interval on both sides. The existing exclusion constraint therefore keeps a professional's visits, and any venue bookings, from overlapping, travel included. Availability for `location=home` uses the same widened interval, so the first home slot of a shift leaves room for travel.
   - Rescheduling keeps the travel buffer the booking was made with.
   - Cancellation refunds follow the service's policy on the whole price, travel fee included.
   - Commission applies to the whole booking price, travel fee included (proposed; D2 says nothing about travel fees).
6. **Privacy.** Account deletion (ADR-0019) now also clears the address, name and phone kept on the customer's bookings. A trigger on `users.deleted_at` does this; the booking stays for the business's and tax records.

## Consequences

- A business's staff see the visit address in the calendar. Only members with access to the booking see it.
- Phone and walk-in bookings made by the business stay at the venue.
- Travel time is a fixed buffer, not a route calculation. A maps-based estimate can replace it later without changing the overlap rule.
- Which licence each emirate requires is not checked automatically. A compliance admin decides from the uploaded document.

## Open questions for the founder

- Which licence must a home-service business hold in each emirate, and which authority issues it?
- Should commission apply to the travel fee?
- Should a late cancellation refund the travel fee in full?
