# Admin console
Separate web console, MFA required, invite-only. Platform roles: superadmin, compliance, catalog, operations, finance, support, analyst. Enforce permission on every API, require reason for destructive or financial action. No impersonation in MVP.
| Route | Screen and actions |
|---|---|
| /admin/dashboard | GMV by mode, active merchants, bookings, orders, pending verification, disputes, payout exceptions, filters |
| /admin/businesses | Review legal docs, verify license expiry, approve modes/branches, reject with reason, suspend/reactivate |
| /admin/customers | Search accounts, support history, restrict abusive accounts, privacy requests; masked PII |
| /admin/products | Review listings, categories, claims, restricted goods, brands, takedowns |
| /admin/services | Review services, venues, staff eligibility, prohibited treatments, moderation |
| /admin/orders | Cross-merchant fulfillment monitoring, timeline, disputes, eligible refunds |
| /admin/bookings | Appointment monitoring, cancellations, disputes, exception handling |
| /admin/finance | Payments, reconciliation, commission rules, payout holds, refund approval, exports |
| /admin/content | Banners, collections, category taxonomy, localized copy, scheduled publishing |
| /admin/promotions | Platform coupons, funding and usage caps, sponsored disclosure |
| /admin/reviews | Abuse reports, evidence, hide/restore with reason |
| /admin/support | Ticket queues, assignments, SLA, internal notes, customer communications |
| /admin/security | Admin invites, permissions, audit logs, access reviews |
| /admin/settings | Policy versions, emirates, feature flags, integrations, notification templates |
Acceptance: finance changes are versioned and effective-dated; refunds above configurable threshold require two distinct approvers; audit log records actor, timestamp, target, before/after redacted fields, reason; exports logged; suspension never silently cancels existing transactions.
