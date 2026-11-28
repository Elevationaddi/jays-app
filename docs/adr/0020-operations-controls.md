# ADR-0020: Operations controls: categories, emirates and support

Status: Accepted (technical design). The support hours, the first-reply target and the category names follow the founder's decisions D10–D12 (ADR-0018). The pilot emirate (Abu Dhabi) is **proposed** and nothing here starts the pilot.

Date: 2026-11-28

## Context

D10 lists the product and service categories and rules out medical and clinical services. D11 asks admins to switch operations on or off by emirate, category and business. D12 sets support hours of 9 AM to 9 PM daily, a first response within 24 hours, priorities, escalation (with a separate path for payment and security incidents) and attachments. Businesses could already be suspended (phase 2), and emirates already had an `enabled` flag that blocked profile and address changes.

## Decision

1. **Category switch.** `categories.enabled` turns a category off without archiving it.
   - A category is live when it and every ancestor are active and enabled. The database function `category_is_live` checks this, so the rule is the same everywhere.
   - Customers do not see a category that is not live, nor its products (product pages, lists, search, cart and checkout all use the same visibility check), nor its services (venue pages and new bookings).
   - Admins still see it, marked off. Switching is audited (`category.disabled`, `category.enabled`).
   - Existing orders and appointments carry on.
2. **Category tree (D10).** Migration 0009 renames four categories to the founder's wording (Perfumes, Clothing, Hair salons, Spa (non-medical)) and adds Beauty, Footwear, Jewelry, Lifestyle, Waxing and Barbering. Slugs and ids stay, so links and products keep working. There is no medical or clinical category, and a test checks this.
3. **Emirate switch (D11).** Operations admins (`operations.manage`) switch an emirate on or off on the new Operations page, which shows active branches and customers in each one. Switching is audited.
   - When an emirate is off: branches there are hidden from venue pages, new bookings there are refused (`EMIRATE_NOT_AVAILABLE`), customers cannot choose it for their profile or a new address, and a checkout quote to an address there is refused.
   - Existing orders and appointments carry on.
4. **Support (D12).**
   - Tickets have a priority: low, normal, high or urgent. Payment tickets start high; others start normal. Support can change the priority, and the change is audited.
   - Support can escalate a ticket as `payment`, `security` or `operations`, with a reason. Payment and security escalations become urgent. The reason is kept as an internal note the customer never sees, and a `ticket.escalated` outbox event is written for later alerting. The procedure is in the runbook.
   - The first public reply from support is recorded (`first_response_at`) for the 24-hour target. The existing reply-due time and overdue alert stay.
   - `GET /v1/support/info` publishes the hours (09:00–21:00, Asia/Dubai) and the 24-hour target. The customer app shows them and whether support is open now.
5. **Attachments.** Customers can attach up to 5 files to their own ticket: PDF, JPEG or PNG, up to 10 MB each, 30 a day per person.
   - Files use the same private storage flow as merchant documents: a short-lived upload URL, then a completion step that checks the real file type, the size and a malware scan before the file is marked clean.
   - A file that fails is kept as rejected or infected and never listed or served.
   - Only the ticket's customer and support admins can download a file, through a short-lived signed URL. Admin downloads are audited (`ticket.attachment_viewed`).

## Consequences

- The admin console gains an Operations page, category switches on Categories and brands, and priority, escalation, first-reply and attachment controls on tickets.
- Switching by business remains business suspension (phase 2).
- Open: whether escalations should also page someone (needs an alerting destination, ADR-0017), whether the hours change on public holidays and in Ramadan, and the retention period for ticket attachments (legal review, with the ADR-0019 retention list).
