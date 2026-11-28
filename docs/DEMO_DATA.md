# Demonstration data (staging)

Everything described here is **fictional**: every business, person, product, price, address, review and conversation. It exists so the founder, testers and designers can use a realistic marketplace on private staging. Decision record: [ADR-0038](adr/0038-demonstration-data.md).

## How you can tell it is demo data

- Every account email ends in `@demo.jays.example`. `.example` is a reserved domain, so no email can ever reach a real person.
- Every storefront description starts with "Demo business (fictional)" in English, with the same notice in Arabic.
- Order notes, return reasons, tickets and carrier names end in "(demo)". Tracking numbers start with `DEMO`.
- In the database, `users.is_demo` and `businesses.is_demo` are `true`, and the singleton `environment_marker` table says `staging`.
- Every page on staging shows the demonstration-data notice (ADR-0035).

**Production refuses it.** A production API reports "not ready" if any demo user or business exists, or if the database is marked as another environment. The loader itself refuses `APP_ENV=production`.

## What it contains

Numbers are from a full local run on 28 November 2026. Orders and bookings are drawn at random, so each load differs a little.

| Area                    | Content                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product businesses (12) | Makeup (2), skincare (2), perfume, haircare, clothing, footwear, jewellery, accessories, lifestyle, bath and body. Each has a logo, a banner, delivery zones in all seven emirates, and 5 to 8 approved products with English and Arabic names.        |
| Service businesses (8)  | Hair salon, nail salon, makeup artist (also at home), eyelash studio, eyebrow bar, barber, non-medical spa, and an at-home beauty business. Each has branches, staff with five-day shifts, services with durations, add-ons and cancellation policies. |
| Hybrid businesses (3)   | A salon with a shop, a nail studio with a store, and a men's grooming lounge with products. They use both Manage Products and Manage Services.                                                                                                         |
| Review queue (2)        | One business submitted for approval and one still in draft, so the admin approval queue has work in it.                                                                                                                                                |
| Catalogue               | 79 products and 112 variants. Some have a sale price (compare-at price), some variants are low in stock and some are sold out. 46 services, 6 of them also offered at home.                                                                            |
| Customers (12)          | English and Arabic names, each with a delivery address.                                                                                                                                                                                                |
| Orders (70)             | Paid with the **mock** payment provider. About 8% are declined test payments. The rest are spread over paid, processing, shipped, delivered and cancelled by the seller.                                                                               |
| Returns                 | Returns approved and refunded (partial refunds), and one rejected.                                                                                                                                                                                     |
| Bookings (156)          | Upcoming bookings over the next 14 days, some cancelled by the customer. Past bookings over the last four weeks: completed, checked in, and no-shows.                                                                                                  |
| Reviews (73)            | Product reviews from delivered orders and service reviews from completed bookings, some with merchant replies.                                                                                                                                         |
| Support tickets (12)    | Open, waiting for the customer, and resolved, with replies from the support team.                                                                                                                                                                      |
| Money                   | 241 ledger transactions created by the real payment, commission, refund and payout rules. The ledger is balanced.                                                                                                                                      |
| Notifications           | 743 notification events, processed in the loader's own process by an in-memory notifier. Nothing is emailed or pushed.                                                                                                                                 |
| Admins (6)              | One per role: super admin, operations, compliance, catalogue, finance and support. Each needs an authenticator app (TOTP).                                                                                                                             |

Analytics pages read from these orders, bookings and ledger entries, so they show realistic numbers without any separate fake figures.

## How it is made

`apps/api/scripts/demo/load-demo.ts` runs the real API inside its own process and goes through the same steps a person would: sign up and verify, create a business, upload a licence and images, submit products, approve them as an admin, add stock, add a basket, check out, pay, fulfil, return, review and reply. So orders, payments, refunds, stock, bookings and the ledger follow the real business rules. Nothing is inserted behind the application's back, with two exceptions:

1. **Business approval** is set directly, because the compliance review is a manual decision on real documents.
2. **Past bookings** are booked as future slots, then moved four weeks back in time (only their times), so that check-in, completion and no-shows can be recorded. Orders are not backdated, because their history tables are append-only.

The business licences and images are generated placeholder files (plain PDFs and colour gradients). The loader's own process scans them with the mock scanner and re-encodes the images with Sharp. **Public document uploads stay switched off on the staging API** (ADR-0035). The loader creates no real document.

## Loading it

### On staging (GitHub Actions)

Follow [STAGING.md](STAGING.md) section 3. In short:

1. Add the secrets to the GitHub environment `staging`: `STAGING_DATABASE_DIRECT_URL`, `STAGING_MFA_ENCRYPTION_KEY`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` and `DEMO_CREDENTIALS_PASSPHRASE`.
2. Run **Staging: migrate database** (type `staging` to confirm).
3. Run **Staging: load demonstration data** (type `fictional-demo-data` to confirm). It takes about two minutes.
4. Download the artifact `demo-credentials-encrypted` within one day, then decrypt it on your own computer:

   ```bash
   gpg --decrypt demo-credentials.json.gpg > demo-credentials.json
   ```

   gpg asks for `DEMO_CREDENTIALS_PASSPHRASE`. Move every account into your password manager, then delete both files.

The loader refuses to run twice. To reload, reset the staging database (STAGING.md, "Rollback"), then run both workflows again.

### Locally

```bash
pnpm dev:deps && pnpm db:migrate
pnpm --filter @jays/api build
pnpm --filter @jays/api demo:load            # full set, about 1.5 minutes
DEMO_SIZE=small pnpm --filter @jays/api demo:load   # fewer orders and bookings, same flows
```

It writes `demo-credentials.json` (readable only by you; ignored by git).

## Demo accounts and passwords

- Every account gets its **own random password** at load time. There are no shared or default passwords, and none are in the repository.
- Passwords are written only to the credentials file, never to the log.
- The file lists, for each account: its role, email, password, where to sign in (customer app, business portal or admin console) and, for admins, a TOTP secret and an `otpauth://` link to add to an authenticator app.
- Sign-up on staging is limited to an allowlist (ADR-0035). Add `@demo.jays.example` to `SIGNUP_ALLOWLIST` so the demo accounts work.

| Kind                | Accounts | Signs in to     |
| ------------------- | -------- | --------------- |
| Customers           | 12       | Customer app    |
| Product businesses  | 12       | Business portal |
| Service businesses  | 8        | Business portal |
| Hybrid businesses   | 3        | Business portal |
| Onboarding (queue)  | 2        | Business portal |
| Admins (one a role) | 6        | Admin console   |

## Safety checks in the loader

- Refuses `APP_ENV=production`.
- On staging, needs `DEMO_DATA_CONFIRM=fictional-demo-data`.
- Refuses a database marked as a different environment; marks an unmarked staging database as `staging`.
- Refuses to run when any demo account already exists.
- Uses the mock payment provider only. No Stripe call is made, in test mode or otherwise.

## Tests

- CI loads the small set into a fresh database on every change, checks that a second load is refused and that every business is marked as demo data, then runs the encrypted restore drill on it.
- Integration tests check that production readiness refuses demo data and a staging marker.
- The full set was loaded locally on 28 November 2026 in 81 seconds, then backed up with `age`, restored and compared: 90 tables matched and the ledger was balanced.
- **Not yet done:** a load into the real staging database. That needs the staging projects and secrets (STAGING.md).
