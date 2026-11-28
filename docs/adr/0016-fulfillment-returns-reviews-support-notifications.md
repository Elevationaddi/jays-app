# ADR-0016: Fulfillment, returns, reviews, support, notifications, dashboards and exports

Status: Accepted (engineering). The return window, support hours and email/SMS providers are founder decisions (ADR-0007 D7, D12, D14). The values used here are assumptions, listed under "Assumptions needing founder approval".

Date: 2026-11-28

## Context

Phase 6 covers what happens after the sale (docs/10-build-plan.md):

- merchants ship orders with tracking, or cancel them;
- customers cancel, return and review;
- support works a ticket queue;
- notifications reach people reliably (T12);
- dashboards and audited exports exist for businesses and admins.

T10 requires that only someone who received a delivered item, or attended a completed appointment, can review it. CLAUDE.md requires that fulfillment and refunds are never faked: every state change must come from a real action, and money moves only when the provider confirms it.

## Decision

### Fulfillment

A suborder moves through these states:

- `paid → processing → shipped → delivered`.
- `paid` can also go straight to `shipped`.
- Shipping needs a carrier and a tracking number; a tracking link is optional and must be https. A database CHECK enforces both rules: a shipped suborder has tracking, and a delivered one has both `shipped_at` and `delivered_at`.

Each action works like this:

- The merchant sends the status they saw (`expectedStatus`). A stale action is refused with 409 `VERSION_CONFLICT`.
- The row is locked `FOR UPDATE` while the change is made.
- Each change is written to the append-only `merchant_order_events` and the audit log, and announced through the outbox.
- The timeline starts with a synthetic `paid` entry taken from the order.

**Cancellation before dispatch.** A merchant can cancel while the suborder is `paid` or `processing`; a customer only while it is `paid`. A cancellation:

- needs a reason when the merchant cancels;
- puts the stock straight back on sale, with a `restock` stock movement;
- refunds the whole suborder, items and delivery, through `PaymentsService.requestRefund` with the suborder id, so the seller's earning is reversed when the provider confirms;
- returns 422 `NOT_REFUNDABLE` if the payment cannot be refunded automatically, and nothing changes.

After dispatch, only the return workflow applies.

### Returns

A customer asks to return units of a delivered suborder within 14 days of delivery. A suborder can have only one return in progress at a time (partial unique index). A return moves through these states:

- `requested → approved | rejected` (rejecting needs a reason);
- `approved → received`. This records a refund with reason `return` and `return_request_id`, and the return becomes `refund_pending`;
- `refund_pending → refunded | refund_failed`, applied by the refund webhook in the same transaction that settles the refund. A refund that fails at the provider also marks the return `refund_failed` and flags the payment for operations.

What a return refunds:

- Each unit refunds what it actually paid: the line total after its discount, spread over its units, with the rounding remainder on the last unit. Several partial returns of a line therefore always add up to exactly what was paid.
- Delivery is not refunded on a return.

Restocking is a separate inventory adjustment (`return_restock`), because a returned item may not be sellable.

### Reviews (T10)

- Only a delivered order item, or a booking with status `completed`, can be reviewed, and only once (unique `order_item_id` and `booking_id`).
- The public lists show only published reviews and the author's first name. The average leaves out hidden reviews.
- Merchants reply. Replies are append-only: the newest one is shown and the history is kept. Merchants can report a review (one open report at a time), but cannot hide or edit one.
- Admins with `reviews.moderate` hide, restore or dismiss a report. Each needs a reason, is audited, and closes the open report.

### Support

Tickets move through these states:

- `open → assigned → awaiting_reply → resolved`;
- a customer reply on a resolved ticket reopens it;
- a customer reply while awaiting the customer sends it back to the queue.

Rules:

- A ticket may refer only to the customer's own order or booking.
- The first-reply SLA is 24 hours from creation or reopening. A ticket is overdue while it waits for support past that time.
- Internal notes are stored with `internal = true` and never returned to the customer. A CHECK makes sure only admins write them.
- An admin reply notifies the customer (`ticket.replied`).

### Notifications (T12)

`NotificationsService.dispatch` reads due outbox rows, claiming one at a time with `FOR UPDATE SKIP LOCKED`. For each event it:

- finds the recipients: the customer for order, return, booking, ticket and review events; business members with `returns.manage` for `return.requested`;
- renders the newest template version in the recipient's language;
- writes an in-app notification (unique `(outbox_id, user_id)`);
- emails a verified address through the `Notifier` (one per `(outbox_id, user_id, channel)`, recorded in `notification_deliveries`).

A retry therefore only sends what is still missing. Failure handling:

- a failure backs off 30 s, 1 min, 2 min and so on, capped at 1 hour;
- after 6 attempts the event becomes `failed`;
- an event left `processing` for more than 10 minutes is taken over by the next run.

The dispatcher runs every 5 seconds inside the API, because the notifier adapter lives there (as the payment adapter does). Tests call it directly. Running it on several instances is safe.

Templates are append-only and versioned per event and language (seeded v1 in English and Arabic). An admin edit may use only the placeholders that version 1 offers (`UNKNOWN_PLACEHOLDER`), so a template cannot ask for data the dispatcher does not provide.

### Dashboards

Figures are computed at request time. Ranges are inclusive Asia/Dubai dates; the default is the last 30 days and the maximum is 366.

| Metric             | Definition                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Gross sales (shop) | Suborder totals (items, delivery and VAT, after discounts) of orders paid in the range                                              |
| Refunds            | Refunds the provider confirmed in the range for the business's suborders                                                            |
| Net sales          | Gross minus refunds                                                                                                                 |
| Order counts       | Current status of the suborders paid in the range                                                                                   |
| Low stock          | Active variants with available stock at or below their threshold                                                                    |
| Bookings           | Appointments starting in the range, excluding holds and expired holds                                                               |
| Revenue (services) | Price of completed appointments                                                                                                     |
| Occupancy          | Booked minutes (confirmed, checked in, completed, no-show) over the minutes of the weekly shifts on those dates                     |
| GMV (admin)        | Captured payments by target (order or booking), by capture date                                                                     |
| Commission (admin) | Commission minus commission refunded on earnings created in the range                                                               |
| Active merchants   | Businesses with at least one earning in the range                                                                                   |
| Open-work counts   | Live counts: verification queue, open disputes, payout exceptions, tickets, overdue tickets, reported reviews, failed notifications |

### Exports

- Admins with `exports.run` can download payments, refunds, payouts, orders and bookings as CSV. Business members with `finance.view` can download their statement.
- Exports carry ids, amounts and statuses, never contact details or addresses.
- Every export is audited (`export.created`) with its kind, dates and row count.
- Limits: 366 days and 50,000 rows.
- Cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheet apps cannot run them as formulas. Plain numbers are left as they are.

### Access

New business capabilities:

| Capability        | Granted to                  |
| ----------------- | --------------------------- |
| `returns.manage`  | owner, manager, fulfillment |
| `reviews.respond` | owner, manager              |
| `dashboard.view`  | owner, manager, finance     |

New platform capabilities. Superadmin holds them all.

| Capability             | Granted to                                        |
| ---------------------- | ------------------------------------------------- |
| `orders.view`          | compliance, operations, finance, support, analyst |
| `reviews.moderate`     | compliance, catalog, support                      |
| `support.handle`       | operations, support                               |
| `notifications.manage` | operations                                        |
| `exports.run`          | compliance, finance, analyst                      |

## Assumptions needing founder approval

- **D7, return window:** 14 days after delivery, for all businesses. Delivery fees are not refunded on returns. Cancellation is allowed until dispatch for merchants, and until processing starts for customers.
- **D12, support hours:** a 24-hour first-reply SLA counted around the clock. Support hours are not shown to customers until they are set.
- **D14, email and SMS providers:** only the mock notifier exists, and production refuses it. SMS notifications are not sent yet.
- **Reviews:** moderation rules (what gets hidden) are not yet written down. Admins decide case by case, with a recorded reason.

## Consequences

- Fulfillment state, returns and reviews can always be traced through events, refunds and audit entries.
- A notification can be delayed by a provider outage, but it is never lost or duplicated.
- Moving the dispatcher to the worker needs the notifier adapter there; until then, the API must run for notifications to go out.
