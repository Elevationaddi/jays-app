# Private staging runbook

Design: [ADR-0035](adr/0035-private-staging.md), which builds on [ADR-0033](adr/0033-vercel-deployment.md). Accounts and keys: [FOUNDER_SETUP_GUIDE.md](FOUNDER_SETUP_GUIDE.md). Costs: [INFRASTRUCTURE_COSTS.md](INFRASTRUCTURE_COSTS.md).

> **Status: prepared, not deployed.** The founder approved private staging on the existing Vercel account (question 1, 28 November 2026), subject to step 0 below. No Vercel project, Supabase project or key exists for JAYS yet. Keys never go through chat.

## What staging is

Staging is a private copy of the whole application, filled with fictional demonstration data:

- customer web app;
- business portal;
- admin console;
- API, with its cron jobs;
- the Supabase database and private file storage.

Rules:

- **Who can get in:** only invited people.
- **Payments:** Stripe test mode only. Live keys are refused by the code.
- **Documents:** real documents cannot be uploaded.
- **Search engines:** nothing is indexed.
- **Data:** no real personal information.

| Piece              | Service                                 | Plan               |
| ------------------ | --------------------------------------- | ------------------ |
| 4 staging projects | Vercel (existing account)               | Your existing plan |
| Database, files    | Supabase project `jays-staging`         | Free               |
| Email              | Resend (staging key)                    | Free               |
| Payments           | Stripe **test mode**                    | No charge in test  |
| Push               | Firebase project `jays-staging`         | Spark (no cost)    |
| Migrations, seed   | GitHub Actions (manual workflows)       | Free minutes       |
| Malware scanning   | Mock scanner (test mechanism, ADR-0032) | –                  |

## 0. Before the first deployment (founder)

- [ ] **Confirm the Vercel plan.** Open **Settings → Billing** and check whether the plan is **Pro** or **Hobby**. The connector can see the team ("elevationaddi's projects", with one existing project, `elevation-platform`), but not the plan.
  - Staging needs Pro: Hobby runs cron jobs at most once a day, and its terms do not cover commercial use.
  - If the plan is Hobby, stop here. Upgrading is a cost decision for you.
- [ ] **Check the available usage.** On **Usage**, check how much of the included usage `elevation-platform` already uses. Staging shares it.
- [ ] **Turn on spending controls.** In **Settings → Billing → Spend Management**:
  - set a low amount;
  - turn on the alerts;
  - tick **Pause production deployments** when the amount is reached.
- [ ] **Create the free accounts.** Supabase, Resend, Stripe (test mode) and Firebase Spark: setup guide, steps 2 to 5. Use the staging names.
- [ ] **Approve.** Tell the team when the plan and spending controls are confirmed. The team then creates the four projects.

## 1. Create the four staging projects

For each row: **Add New → Project**, import `Elevationaddi/jays-app`, set the root directory, and leave "Include files outside the root directory" on.

| Project                 | Root directory  | Framework preset      | Deployment Protection                             |
| ----------------------- | --------------- | --------------------- | ------------------------------------------------- |
| `jays-staging-api`      | `apps/api`      | Other (`vercel.json`) | **Vercel Authentication: off** (API gates itself) |
| `jays-staging-business` | `apps/business` | Next.js               | Vercel Authentication: **Standard Protection**    |
| `jays-staging-admin`    | `apps/admin`    | Next.js               | Vercel Authentication: **Standard Protection**    |
| `jays-staging-web`      | `apps/customer` | Other (`vercel.json`) | Vercel Authentication: **Standard Protection**    |

- **Production branch:** `main`, under **Settings → Git**. In these projects, "Production" means staging. Cron jobs only run on Production deployments.
- **Domains:** do not add a custom domain. Standard Protection covers the `vercel.app` addresses only while there is none.
- **Do not turn on Password Protection.** It is a paid add-on.
- **Protection bypass:** on `jays-staging-api` only, if Vercel Authentication is ever turned on there, create a **Protection Bypass for Automation** secret for Stripe's webhook. With the recommended setting (off), this is not needed.

## 2. Environment variables

Add every value under **Settings → Environment Variables**, environment **Production** (of the staging project), and mark secrets **Sensitive**. Generate random values with `node scripts/staging/generate-secrets.mjs` on your own computer. The script prints new values to your terminal only.

### `jays-staging-api`

| Variable                                                                                                 | Value                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                                                | `staging`                                                                                                           |
| `DATABASE_URL`                                                                                           | Supabase `jays-staging` **transaction pooler** (port 6543)                                                          |
| `RATE_LIMIT_STORE` / `SCHEDULERS` / `DB_POOL_MAX` / `TRUST_PROXY_HOPS`                                   | `postgres` / `off` / `3` / `1`                                                                                      |
| `CRON_SECRET`                                                                                            | generated                                                                                                           |
| `STAGING_ACCESS_TOKEN`                                                                                   | generated (also given to the three other projects)                                                                  |
| `SIGNUP_MODE`                                                                                            | `allowlist`                                                                                                         |
| `SIGNUP_ALLOWLIST`                                                                                       | the testers' emails, comma separated, plus `@demo.jays.example` for the demo accounts                               |
| `DOCUMENT_UPLOADS`                                                                                       | `disabled`                                                                                                          |
| `API_PUBLIC_URL`                                                                                         | `https://jays-staging-api.vercel.app/v1` (the project's address)                                                    |
| `CORS_ORIGINS`                                                                                           | the business, admin and web `https://…vercel.app` addresses                                                         |
| `ADMIN_WEB_URL`, `BUSINESS_WEB_URL`                                                                      | the admin and business addresses                                                                                    |
| `JWT_KEYS`                                                                                               | `stg1:` + generated                                                                                                 |
| `OTP_SECRET`, `MFA_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `METRICS_TOKEN`                            | generated, each different                                                                                           |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`                                                                     | `supabase`, `jays-files`                                                                                            |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                                              | Supabase `jays-staging` (setup guide 2.6)                                                                           |
| `MALWARE_SCANNER`                                                                                        | `mock` (a test mechanism; uploads of documents are off anyway)                                                      |
| `NOTIFY_PROVIDER`, `EMAIL_KEY`, `EMAIL_FROM`                                                             | `resend` and the staging key (setup guide 3). Until a domain is verified, use `mock` (see "Email without a domain") |
| `PUSH_PROVIDER`, `FCM_SERVICE_ACCOUNT_JSON`                                                              | `fcm` and the staging Firebase key, or `none` until it exists                                                       |
| `PSP_PROVIDER`, `PSP_API_KEY`, `PSP_PUBLISHABLE_KEY`, `PSP_WEBHOOK_SECRET`, `PSP_CONNECT_WEBHOOK_SECRET` | `stripe` with **test** keys, or `mock` with a generated `PSP_WEBHOOK_SECRET` until Stripe exists                    |
| `MOCK_PAYMENT_OUTCOMES`                                                                                  | `false`                                                                                                             |
| `DELIVERY_PARTNER`                                                                                       | `none`                                                                                                              |

### `jays-staging-business` and `jays-staging-admin`

| Variable               | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `APP_ENV`              | `staging` (shows the demonstration-data notice)                             |
| `API_URL`              | `https://jays-staging-api.vercel.app/v1`                                    |
| `STAGING_ACCESS_TOKEN` | the same value as the API's. Server-side only: it never reaches the browser |

### `jays-staging-web`

| Variable                           | Value                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_APP_ENV`              | `staging` (notice, noindex)                                                                             |
| `EXPO_PUBLIC_API_URL`              | `https://jays-staging-api.vercel.app/v1`                                                                |
| `EXPO_PUBLIC_STAGING_ACCESS_TOKEN` | the same token. It is visible inside the web app, which only Vercel team members can open (ADR-0035 §2) |

### Email without a domain

Resend sends to anyone only from a **verified domain**, and buying a domain needs the founder's approval. Without one:

- Resend's test sender delivers only to the Resend account owner's own address.
- Until a domain is approved, staging uses `NOTIFY_PROVIDER=mock`. Codes then appear in the API log (Vercel → `jays-staging-api` → Logs, lines starting `[mock email]`), which only team members can read.
- Real email tests (phase 16) wait for the domain.

## 3. Database: migrations and demonstration data

Migrations never run inside Vercel. Two manual GitHub Actions workflows do it, from the **Actions** tab:

1. **Add the secrets.** In **Settings → Environments → New environment**, name it `staging` and add these secrets:
   - `STAGING_DATABASE_DIRECT_URL`: the Supabase **direct** connection, port 5432;
   - `STAGING_MFA_ENCRYPTION_KEY`: the same value as the API's `MFA_ENCRYPTION_KEY`;
   - `DEMO_CREDENTIALS_PASSPHRASE`: a long passphrase from your password manager.
2. **Run "Staging: migrate database".** It applies `packages/db/migrations` and refuses any database that is not marked as staging.
3. **Run "Staging: load demonstration data".** It loads the fictional dataset ([DEMO_DATA.md](DEMO_DATA.md)) with newly generated passwords. The credentials file is encrypted with your passphrase and kept as a workflow artifact for one day. Download it, decrypt it (DEMO_DATA.md shows how) and keep it in your password manager.

## 4. First deployment checks

Deploy by merging to `main`, or with **Redeploy** in each project. Then check each item below, and record the results in `IMPLEMENTATION_STATUS.md` under "Staging-tested". Nothing is marked tested until it has actually run.

- [ ] `GET /v1/health` answers 200 without the header. `GET /v1/health/ready` shows `database: up`, `redis: not_used`.
- [ ] `GET /v1/categories` without `x-staging-access` answers **401** `STAGING_ACCESS_REQUIRED`. With the header, it answers 200.
- [ ] `https://jays-staging-api.vercel.app/robots.txt` disallows everything. Every response has `X-Robots-Tag: noindex`.
- [ ] The business, admin and web addresses ask for a Vercel sign-in in a private browser window.
- [ ] Each page shows the demonstration-data notice, in English and Arabic.
- [ ] Registering with an email that is not on the list answers "invitation only".
- [ ] Starting a document upload in the business portal answers "uploads are switched off".
- [ ] The **Cron Jobs** tab of `jays-staging-api` lists three jobs, and their runs answer 200.
- [ ] A Stripe **test** webhook is accepted with a verified signature (raw body check, ADR-0033). If it fails with a signature error, set `NODEJS_HELPERS=0` and redeploy.
- [ ] Sign-in rate limiting answers 429 after repeated wrong passwords.
- [ ] A product image uploads and displays.
- [ ] A test card payment (`4242 4242 4242 4242`) marks an order paid and appears in Stripe's **test** dashboard.
- [ ] The admin usage card shows database, storage and email against the free limits.
- [ ] Cold start and warm request times are noted.
- [ ] After a few days, compare Vercel's usage page with the estimate in INFRASTRUCTURE_COSTS.md.

## 5. Health and monitoring

- **Liveness:** `/v1/health`. **Readiness:** `/v1/health/ready`, which checks the database. **Metrics:** `/v1/metrics`, with `METRICS_TOKEN`.
- Vercel's logs and the admin console's operations page (outbox, failed notifications, usage) are the monitoring. No paid monitoring service is used (ADR-0024).

## 6. Rollback

- **Application:** in the staging project, open **Deployments**, choose the last good deployment, then **⋯ → Promote**. It takes effect in seconds without a rebuild. Pro can promote any earlier deployment.
- **One app only:** each project rolls back on its own. If the API changed a contract, roll the portals back at the same time.
- **Database:** migrations only move forward. Before a risky migration, run the backup workflow once it is approved (ADR-0037). Otherwise reset staging: delete and recreate the Supabase project, run the migrate workflow, then the demo-data workflow. Staging data is fictional, so a reset loses nothing real.
- **Keys:** if a staging key leaks, rotate it in the provider and in Vercel, then redeploy.
  - `STAGING_ACCESS_TOKEN` must change in all four projects together.
  - Changing `JWT_KEYS` signs everyone out. Use the `kid:secret` order to rotate without that (ADR-0009).
- **Turning staging off:** pause the four projects (**Settings → General → Pause**) or delete them. Supabase Free also pauses a project after a week without activity.

## 7. What staging does not do

- Take a real payment, or hold a live key.
- Accept a real merchant document.
- Run ClamAV. That waits for a host (ADR-0032 and [CLAMAV_HOSTING_REVIEW.md](CLAMAV_HOSTING_REVIEW.md)).
- Send email to arbitrary addresses before a domain is approved.
- Show its data to the public, or present it as real marketplace activity.
