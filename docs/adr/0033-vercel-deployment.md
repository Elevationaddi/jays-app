# ADR-0033: Vercel deployment design

Status: Accepted (technical design). **Nothing has been deployed.** Deploying, creating Vercel projects and setting production variables all need the founder's explicit approval. No Vercel result is claimed: the function entry, cron routes and PostgreSQL rate limits are tested locally against real PostgreSQL, not on Vercel.

Date: 2026-11-28

> **Update:** staging is now a separate set of `jays-staging-*` projects, not each project's Preview environment, because Vercel Cron runs only on Production deployments ([ADR-0035](0035-private-staging.md)).

## Context

ADR-0024 chose Vercel for hosting and listed what had to change for serverless: no long-running timers or worker, no Redis subscription, small connection pools behind Supabase's pooler, and files that never pass through a function body. Phase 10 makes those changes and writes the deployment design. The founder asked for no external deployment and no new charges.

## Decision

### 1. Four Vercel projects from one repository

| Project         | Root directory  | What it runs                                                                   | Config                      |
| --------------- | --------------- | ------------------------------------------------------------------------------ | --------------------------- |
| `jays-api`      | `apps/api`      | The NestJS API as one Node.js function (`api/index.mjs`), plus three cron jobs | `apps/api/vercel.json`      |
| `jays-business` | `apps/business` | Business portal (Next.js)                                                      | `apps/business/vercel.json` |
| `jays-admin`    | `apps/admin`    | Admin console (Next.js)                                                        | `apps/admin/vercel.json`    |
| `jays-web`      | `apps/customer` | The customer app's web build (`expo export`, static files)                     | `apps/customer/vercel.json` |

- Functions run in Mumbai (`bom1`), next to the Supabase database (ADR-0024, section 5).
- Each project's **Preview** environment is staging, with its own Supabase project and keys. **Production** has its own.
- The iOS and Android apps are built with Expo and published through the stores, not on Vercel (phase 11).

### 2. The API as a function

- `src/vercel.ts` builds the same Nest application as `main.ts`, once per function instance, and reuses it across requests (Fluid compute). Configuration is validated on the first request. If start-up fails, the request gets a plain `503` without details, the error is logged by variable name only, and the next request tries again.
- `vercel.json` rewrites every path to the function, so routes, contracts and webhooks are unchanged.
- The function's maximum duration is 60 seconds. Nothing in a request takes longer: files never pass through it (section 5).

### 3. Background jobs from Vercel Cron

- With `SCHEDULERS=off`, the in-process timers (notifications every 5 s, the finance check every hour) do not start, and the worker process is not deployed.
- Three protected routes run the same work:

  | Route                            | Schedule        | Runs                                                                        |
  | -------------------------------- | --------------- | --------------------------------------------------------------------------- |
  | `/v1/internal/cron/minute`       | every minute    | notifications (up to 500), expiring unpaid orders and booking holds         |
  | `/v1/internal/cron/five-minutes` | every 5 minutes | booking reminders and waitlist expiry, old rate-limit windows               |
  | `/v1/internal/cron/hourly`       | hourly, at :07  | payout eligibility, account deletions, daily reconciliation, weekly payouts |

- Vercel sends `Authorization: Bearer $CRON_SECRET`. The routes compare it in constant time, answer `404` when no secret is configured and `401` for a wrong one, and are left out of the public OpenAPI document. Configuration refuses `SCHEDULERS=off` without a secret, so jobs cannot silently stop.
- The worker and the cron routes run the **same SQL statements** (`JOB_SQL` in `@jays/db`), so both apply the same rules under the same database locks.
- Every step is idempotent and safe to overlap: database functions lock their rows, the outbox is claimed with `SKIP LOCKED`, and reconciliation and payout runs claim their row first. One failing step does not stop the others; the run answers `500` so the failure is visible in Vercel's cron log.
- Correctness never depends on the timer: the API already expires stale holds and reservations before allocating new ones. A minute's delay only affects how fast notifications go out and how fast stale holds disappear from dashboards.
- **This needs Vercel Pro.** Hobby allows cron at most once a day, and its commercial-use terms were not confirmed (cost register). On Hobby, the minute and five-minute jobs could not be scheduled.

### 4. No Redis: rate limits in PostgreSQL

- `RATE_LIMIT_STORE=postgres` counts request rate limits in an unlogged table (`rate_limit_counters`, migration 0019) with one atomic upsert per check: a window that has ended restarts at 1, otherwise the count goes up. Concurrent requests cannot overshoot (tested).
- It fails closed like the Redis limiter: if the database cannot be reached, sign-in and other limited endpoints answer `503`, never "unlimited".
- Readiness reports Redis as `not_used` and does not require it. Redis stays supported for self-hosting (ADR-0017).

### 5. Files never pass through a function

- Vercel limits request and response bodies to 4.5 MB.
- **Business documents** (up to 10 MB) are now sent **straight from the browser** to the signed upload URL. A small client component asks a server action for the signed target, sends the file, then asks a second server action to have the API check and scan it. The browser only ever sees the one short-lived URL for that one file.
- **Images** are limited to 4 MB (ADR-0032), so their server-action path stays under the limit. The business portal's server-action body limit is now 4.5 MB (was 11 MB).
- Downloads of private documents use the storage provider's signed URLs (ADR-0032). Images are served through the API and cached by the CDN.

### 6. Database connections

- `DB_POOL_MAX` sets connections per instance (default 10; **3 on Vercel**), and idle connections close after 10 seconds, because frozen instances should not hold them.
- `DATABASE_URL` is Supabase's **transaction pooler** (port 6543). The code uses only transaction-scoped features (row locks, `pg_advisory_xact_lock`, `SKIP LOCKED`), which transaction pooling allows.
- Migrations run against the **direct** connection (port 5432) from a machine or a GitHub Actions job, never from a function, and only with approval for production.

### 7. Free-tier usage card

- `GET /v1/admin/operations/usage` (operations admins and superadmins) returns the database size, the size of accepted files, and email sent today and this month, each against the free plan's limit.
- The admin dashboard shows it as a card. A meter turns amber at 80%. Upgrading any plan needs the founder's approval.

### 8. Security headers

- The business portal and admin console send `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, a restrictive permissions policy and HSTS on every page. The customer web build sends the same through `vercel.json`. The API already uses Helmet.

## Configuration on Vercel (API project)

| Variable           | Value on Vercel                            |
| ------------------ | ------------------------------------------ |
| `RATE_LIMIT_STORE` | `postgres` (no `REDIS_URL`)                |
| `SCHEDULERS`       | `off`                                      |
| `CRON_SECRET`      | a random value of at least 32 characters   |
| `DB_POOL_MAX`      | `3`                                        |
| `TRUST_PROXY_HOPS` | `1` (Vercel's edge sets `X-Forwarded-For`) |
| `STORAGE_PROVIDER` | `supabase`                                 |
| `API_PUBLIC_URL`   | the API's https address with `/v1`         |

The full list, and who provides each value, is in `docs/DEPLOYMENT.md` and the setup guide.

## Not verified, and why

- **Nothing ran on Vercel.** The function entry was tested by serving it from a local Node HTTP server; cron routes and PostgreSQL rate limits were tested against real PostgreSQL. Cold-start time, the bundle size limit and Vercel's request handling must be checked on the first staging deployment, which needs approval.
- **Request body handling.** Vercel's Node.js helpers can parse request bodies before the application sees them. Payment webhooks need the exact raw bytes. If staging shows a problem, set `NODEJS_HELPERS=0` on the API project. This must be checked with a Stripe test webhook in staging.
- **Best-effort dispatch after a response** (ADR-0024) was not built: it needs Vercel's `waitUntil`, which means a new package. Notifications go out within about a minute through the cron route instead.

## Consequences

- One codebase runs both on Vercel (`SCHEDULERS=off`, `RATE_LIMIT_STORE=postgres`) and self-hosted with Docker (timers, worker and Redis), selected by configuration.
- The minute cron and the pooled database connections are the main Vercel usage. Both are expected to stay within the Pro plan's included usage for the pilot (cost register, section 2); this must be confirmed from Vercel's usage page in staging.
- ADR-0024 section 6's interim plan (quarantining documents until a scanner exists) is replaced by ADR-0032: production does not start without a real scanner.
