# ADR-0038: Fictional demonstration data through the real flows

Status: Accepted. Built and tested locally and in CI. Not yet loaded into the real staging database.

Date: 2026-11-28

## Context

The founder asked for a complete fictional dataset on staging: product, service and hybrid businesses across the beauty categories, with catalogues, prices, discounts, stock, staff, calendars, orders, bookings, returns, refunds, reviews, notifications, tickets, financial records and analytics. It must be clearly identifiable as demo data, with separate accounts for each kind of user and securely generated credentials. Staging must never hold real personal data (ADR-0035).

The existing `seed` script creates a small fixed set for local development. It inserts rows directly and is not enough for a realistic staging marketplace.

## Decision

1. **Generated through the application.** `apps/api/scripts/demo/load-demo.ts` starts the API in its own process (the integration-test harness, with the mock payment provider and in-memory notifier) and calls the real endpoints. Payments, commission, refunds, stock movements, the ledger, booking locks and notifications therefore follow the real rules. Two shortcuts, both documented in DEMO_DATA.md: business approval is set directly, and past bookings have their times moved back four weeks. Orders are never backdated, because their event and ledger tables are append-only.
2. **Marked in the database.** Migration `0021_demo_data_markers` adds `users.is_demo`, `businesses.is_demo` and a singleton `environment_marker` table (`local`, `test`, `staging` or `production`) that cannot be changed once set.
3. **Production refuses it.** In production, the readiness check fails if any demo user or business exists, or if the marker says another environment. The loader refuses `APP_ENV=production` and needs an explicit confirmation on staging.
4. **Identifiable everywhere.** Emails on `demo.jays.example` (a reserved domain), a fictional-business notice in every storefront description, "(demo)" in free text, and the staging notice on every page.
5. **Credentials.** Each account gets a random password at load time, and each admin a TOTP secret. They are written only to a file (mode 0600). On staging, the GitHub workflow encrypts that file with the founder's passphrase (gpg, AES-256) and keeps it as an artifact for one day.
6. **Loading on staging** is two manual GitHub Actions workflows: "Staging: migrate database" and "Staging: load demonstration data". Both run in the GitHub environment `staging`, and neither runs on a schedule.

## Consequences

- Designers and testers see realistic states (sold out, on sale, cancelled, refunded, no-show, awaiting reply) without anyone entering data by hand.
- Any change that breaks a core flow also breaks the demo load in CI.
- The dataset differs a little on each load, because orders and bookings are drawn at random.
- Reloading staging means resetting its database first.
- Building the dataset found a real defect: a re-encoded image a few hundred bytes larger than the declared upload size was refused. Fixed: the clean copy is now checked against the purpose's hard limit, with a regression test (`uploads.test.ts`).
