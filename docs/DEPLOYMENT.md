# Deployment runbook (Vercel)

Design: [ADR-0033](adr/0033-vercel-deployment.md). Cost rules: [ADR-0024](adr/0024-cost-constraints-and-vercel-first-architecture.md) and [INFRASTRUCTURE_COSTS.md](INFRASTRUCTURE_COSTS.md).

> **Staging has its own runbook: [STAGING.md](STAGING.md)** ([ADR-0035](adr/0035-private-staging.md)). It replaces the "Preview = staging" plan below, because Vercel Cron only runs on Production deployments: staging is a separate set of four `jays-staging-*` projects whose Production environment is staging. This file remains the reference for the production project set.

> **Nothing here has been done.** Every step that creates a project, sets a production value, runs a production migration or deploys needs the founder's explicit approval first. Keys are never pasted into chat: the founder adds them in Vercel's dashboard ([FOUNDER_SETUP_GUIDE.md](FOUNDER_SETUP_GUIDE.md), step 7).

## 0. Before anything is deployed

- [ ] Founder confirms the Vercel account is on **Pro** (cron every minute and commercial use need it).
- [ ] Spend management: a low alert and the "pause projects" action are set (setup guide, step 1).
- [ ] Supabase staging project exists, with the private `jays-files` bucket (setup guide, step 2).
- [ ] Resend domain verified (step 3); Stripe **test** keys and webhooks (step 4); Firebase project (step 5).
- [ ] Where ClamAV runs is decided. Staging may use `MALWARE_SCANNER=mock`; production cannot start without ClamAV (ADR-0032).
- [ ] CI is green on `main`.

## 1. Create the four projects (founder approval)

In Vercel, **Add New → Project**, import the GitHub repository four times:

| Project         | Root directory  | Framework preset           |
| --------------- | --------------- | -------------------------- |
| `jays-api`      | `apps/api`      | Other (from `vercel.json`) |
| `jays-business` | `apps/business` | Next.js                    |
| `jays-admin`    | `apps/admin`    | Next.js                    |
| `jays-web`      | `apps/customer` | Other (from `vercel.json`) |

Leave "Include files outside the root directory" on: the apps use the shared `packages/`. Each `vercel.json` sets the install and build commands and the Mumbai region.

## 2. Environment variables

Set **Production** values in the production projects. Staging values go into the `jays-staging-*` projects (STAGING.md, step 2). Values marked _generate_ are random strings of at least 32 characters, different for each environment, never the local ones.

### `jays-api`

| Variable                                                                                                 | Value                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                                                | `staging` (Preview) or `production`                                                                                        |
| `DATABASE_URL`                                                                                           | Supabase transaction pooler, port 6543                                                                                     |
| `RATE_LIMIT_STORE`                                                                                       | `postgres`                                                                                                                 |
| `SCHEDULERS`                                                                                             | `off`                                                                                                                      |
| `CRON_SECRET`                                                                                            | _generate_                                                                                                                 |
| `DB_POOL_MAX`                                                                                            | `3`                                                                                                                        |
| `TRUST_PROXY_HOPS`                                                                                       | `1`                                                                                                                        |
| `API_PUBLIC_URL`                                                                                         | `https://<api domain>/v1`                                                                                                  |
| `CORS_ORIGINS`                                                                                           | the business, admin and web addresses (https)                                                                              |
| `ADMIN_WEB_URL`, `BUSINESS_WEB_URL`                                                                      | the portal addresses (https)                                                                                               |
| `JWT_KEYS`                                                                                               | `k1:` followed by a _generated_ value                                                                                      |
| `OTP_SECRET`, `MFA_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `METRICS_TOKEN`                            | _generate_ each                                                                                                            |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`                                                                     | `supabase`, `jays-files`                                                                                                   |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                                              | setup guide, step 2.6                                                                                                      |
| `MALWARE_SCANNER` (+ `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TLS`)                                         | `mock` on staging until ClamAV runs; `clamav` with TLS in production                                                       |
| `NOTIFY_PROVIDER`, `EMAIL_KEY`, `EMAIL_FROM`                                                             | `resend` and step 3                                                                                                        |
| `PUSH_PROVIDER`, `FCM_SERVICE_ACCOUNT_JSON`                                                              | `fcm` and step 5                                                                                                           |
| `PSP_PROVIDER`, `PSP_API_KEY`, `PSP_PUBLISHABLE_KEY`, `PSP_WEBHOOK_SECRET`, `PSP_CONNECT_WEBHOOK_SECRET` | `stripe` and step 4 (test keys only; live keys are refused)                                                                |
| `MAPS_KEY`                                                                                               | required by production configuration; a maps provider is still a founder decision                                          |
| `DELIVERY_PARTNER`                                                                                       | `none`                                                                                                                     |
| `SIGNUP_MODE`, `DOCUMENT_UPLOADS`                                                                        | `open` and `enabled` in production only after the pilot and scanner approvals; staging requires `allowlist` and `disabled` |
| `STAGING_ACCESS_TOKEN`                                                                                   | staging only (ADR-0035)                                                                                                    |

Production refuses to start with any mock adapter, local storage, http addresses, a committed example value, or a live Stripe key.

### `jays-business` and `jays-admin`

| Variable  | Value                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| `API_URL` | `https://<api domain>/v1` (the portals call the API from their servers only) |

### `jays-web`

| Variable              | Value                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | `https://<api domain>/v1` (public by design: it is the API's address, not a secret) |

## 3. Database migrations (staging first; production with approval)

Migrations never run inside a function. From a trusted machine, with the **direct** connection string (port 5432):

```sh
DATABASE_URL='<direct connection>' pnpm db:migrate
```

Do not run `pnpm db:seed` against staging or production: the seed is fictional demo data for local use.

## 4. First staging deployment: checks

Deploy by pushing to a branch (Preview). Then check, and write the results in `IMPLEMENTATION_STATUS.md`:

- [ ] `GET /v1/health` answers 200, and `GET /v1/health/ready` shows `database: up`, `redis: not_used`.
- [ ] Cold start time (first request after 10 minutes idle) and warm request time.
- [ ] Vercel's **Cron Jobs** tab lists three jobs; each run answers 200 in the logs.
- [ ] A Stripe **test** webhook is accepted (signature verified). If it fails with a signature error, set `NODEJS_HELPERS=0` on `jays-api` and redeploy (ADR-0033).
- [ ] Sign-in rate limiting answers 429 after repeated wrong passwords.
- [ ] A 9 MB PDF uploads from the business portal (direct upload) and is scanned (or, on staging with the mock scanner, accepted).
- [ ] A 3.5 MB product image uploads and is served through the API with cache headers.
- [ ] Emails arrive (Resend) and the admin usage card shows the count.
- [ ] Vercel's usage page after a few days of testing, compared with the cost register's estimate.

## 5. Production (founder approval, after the staging checks)

- Same steps with the production Supabase project and production values.
- Live payments stay off until the founder approves them (D5); the configuration refuses live keys today.
- The pilot does not start until the founder approves it (phase 12).

## Rollback

- Vercel keeps every deployment: **Deployments → … → Promote to Production** on the previous one rolls back in seconds.
- Database migrations are forward-only. Each phase's rollback note in `IMPLEMENTATION_STATUS.md` says what a reverse migration involves. Take a backup (`infra/backup`) before running a production migration.
