# ADR-0026: Service discovery, add-ons, waitlists, reminders and portfolios

Status: Accepted (technical design). Reminder and waitlist emails count toward the Resend Free daily quota (ADR-0024); the in-app notification is always sent.

Date: 2026-11-28

## Context

Phase 8.7 asks for Fresha-level service browsing: search across venues, add-ons, reminders, waitlists, rebooking, staff profiles, next available time and portfolio photos. Phase 4 (ADR-0014) shipped a venue page and slot availability; there was no cross-venue search and no way to extend a booking.

## Decision

1. **Add-ons** (`service_addons`): up to 20 per service, each with a localized title, a price (0 to 100,000.00 AED) and an extra duration (0 to 240 minutes on the 5-minute grid). Archiving hides an add-on from new bookings only.
   - A booking may take up to 10 add-ons, each once, and the booked length (service plus add-ons) may not exceed 600 minutes.
   - Availability and the hold both use the longer length, so the database overlap guard covers the add-on time.
   - The booking stores an add-on snapshot (`bookings.addons`) and their total (`addons_fils`), both inside `price_fils`; a constraint keeps add-ons plus travel within the price. `service.durationMin` in the snapshot is the total length, so rescheduling needs no change.
   - Add-ons take the service's VAT treatment. Commission applies to the service and add-ons, never to the travel fee (ADR-0025).
   - Invoices itemise the service, each add-on and travel. VAT is split in proportion with `bookingPriceParts`, so the lines always add up to the charged total and VAT.
2. **Search** (`GET /services`): text over service titles and descriptions and venue names in both languages, filters for emirate, at the venue or at home, and 4 stars and up, and sorts by relevance, rating, popularity (completed bookings in the last 90 days) and price. Paging uses an opaque offset cursor. This is a Postgres `ILIKE` scan with a supporting index; it is adequate for the pilot and can move to `tsvector` without an API change. No paid search service is used (ADR-0024).
3. **Ratings** for services, professionals and venues are computed from published booking reviews only.
4. **Next available** (`GET /services/{id}/next-available`): searches up to 14 days across the venue's branches with the same availability engine. It reserves nothing.
5. **Professional bios**: optional, localized, shown on the booking page with the rating.
6. **Portfolio photos** (`portfolio_items`): up to 60 per venue, optionally tagged with a service or professional, uploaded through the existing media pipeline (purpose `portfolio_image`, image rules as for products, scanning as ADR-0024). Public pages read them through `/v1/media/{id}`.
7. **Waitlist** (`booking_waitlist`): a signed-in customer asks to hear when a time opens for a service on a date within a time window, optionally with one professional. At most 5 active entries.
   - Nothing is held. When an active booking is cancelled or expires with a future start, a trigger marks matching entries as notified and queues `booking.waitlist_opened` in the same transaction. The first customer to book gets the time.
   - Past entries expire in the worker job. Account deletion removes entries.
8. **Reminders**: `queue_booking_reminders` marks confirmed bookings starting in the next 24 hours, once each, and queues `booking.reminder`. Bookings confirmed less than 2 hours before the start are skipped. The worker runs it every 5 minutes; Phase 10 moves it to a Vercel cron.
9. **Rebooking** (`GET /bookings/{id}/rebook`): returns the service, professional and add-ons of a past booking that are still offered, and lists what changed (professional unavailable, add-on gone, price changed). The customer then books normally at today's price.

## Consequences

- Every booking path still goes through the same availability check and database lock; no new path can double-book.
- Reminder and waitlist emails may be delayed when the free email quota is used up; the in-app notification is unaffected.
- Not done: SMS reminders (not allowed by ADR-0024), automatic waitlist booking, and paid search.
