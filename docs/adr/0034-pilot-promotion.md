# ADR-0034: Pilot promotion as its own record

Status: Accepted (technical design). The commercial terms come from the founder's decision of 28 November 2026 (ADR-0025, section 3). **The pilot has not been launched.** Recording a business is the founder's per-business approval, made by a person in the admin console.

Date: 2026-11-28

## Context

ADR-0025 planned the pilot promotion as two business fee rules recorded up front: 0% from the start and the default rate from the end. Building it showed a problem. A business-level fee rule outranks the category rates (ADR-0021), so the "end" rule would replace a business's category-specific commission with a single flat rate for good. A business that sells in a category priced at, say, 8% would pay 10% after the pilot instead of 8%.

## Decision

1. **A separate `pilot_promotions` table** (migration 0020), one row per business at most (`UNIQUE (business_id)`): the offer is given once. Each row holds the start, the end (start + 30 days; the database refuses more than 31), the founder's approval reference (5 to 500 characters), who recorded it, and, if it ended early, when, by whom and why.
2. **The commission engine checks the promotion first.** When an earning is recorded at capture, an active, uncancelled promotion whose window contains the capture time sets the commission to 0 bps and links the earning to the promotion (`merchant_earnings.pilot_promotion_id`). Otherwise the normal fee rules apply unchanged, so category rates resume on their own when the window closes. No job has to run.
3. **No retroactive effect.** A promotion can start now or later, never in the past (a minute of clock skew is allowed). Earnings already captured keep the rate snapshotted on them (ADR-0021). Ending a promotion early affects only later captures.
4. **Who can do what.** Finance admins with `finance.manage` record and end promotions; `finance.view` sees the dashboard. Only an approved business can be recorded. Every create and cancel writes an audit entry with the approval reference or the reason.
5. **Notices.** The hourly finance job (worker timer or the hourly cron route, ADR-0033) queues `pilot.promotion_ending` 7 days and 1 day before the end. Each notice is claimed on its row first, so overlapping runs send it once, and inside the last day only the last-day notice goes out. Members with `finance.view` receive it in the app and by email, in English or Arabic, with the date and the standard rate that follows.
6. **Visibility.** The admin console has a pilot page: enrolled businesses against the targets (30 product, 20 service), each business's window, state, sales and gross during the offer, and the approval reference. It notes when a business is outside Abu Dhabi. The business portal's finance page shows a banner with the end date, days left and the standard rate that follows.
7. **The pilot is not launched by software.** The dashboard reports `launch: founder_approval_required`. Nothing enrols businesses automatically.

## Consequences

- ADR-0025 section 3's mechanism (two fee rules) is replaced by this design. Its commercial terms are unchanged.
- Payment processing charges and taxes are unaffected: only the platform commission is waived.
- Tests: domain unit tests for the window, and `pilot.int.test.ts` (30-day waiver at capture, notices once each, normal rate afterwards, early end, refusals and permissions).
