# ADR-0024: Subscription restriction, Vercel-first hosting and free-tier providers

Status: Accepted (founder decision, 28 November 2026, 13:29 Dubai time). It **supersedes** the AWS target in ADR-0017 and ADR-0018, and the Twilio/SMS part of D14 (ADR-0018). Commercial terms that depend on a provider (Stripe's UAE marketplace configuration) are still proposed until the founder approves them.

Date: 2026-11-28

## Context

The founder set a mandatory constraint: apart from Vercel, ChatGPT and Claude, JAYS must not depend on any paid monthly or annual software subscription. We may use:

- free tiers that allow commercial use;
- open-source software;
- the existing Vercel plan within its included usage;
- free GitHub features;
- payment providers that charge per transaction, once the founder approves them.

Free trials do not count as free services. Nothing paid is registered, bought, activated or upgraded without explicit founder authorisation. Pay-as-you-go and overages are never switched on automatically.

Until now the plan assumed AWS (hosting, managed PostgreSQL, S3, Secrets Manager), Twilio for SMS, and a long-running API with a separate worker and Redis (ADR-0017). This ADR replaces that plan.

## Decision

### 1. What JAYS may depend on

The register of every external dependency, with prices checked at the source, is [docs/INFRASTRUCTURE_COSTS.md](../INFRASTRUCTURE_COSTS.md).

| Need                   | Choice                                                                                                     | Plan                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Hosting                | Vercel                                                                                                     | Existing subscription                  |
| PostgreSQL             | Supabase                                                                                                   | Free                                   |
| File storage           | Supabase Storage, private buckets, signed URLs                                                             | Free                                   |
| Payments               | Stripe Connect, test mode only                                                                             | Per-transaction fees, founder approval |
| Email                  | Resend                                                                                                     | Free                                   |
| Push                   | Firebase Cloud Messaging                                                                                   | Spark (no cost)                        |
| Admin two-factor       | Authenticator-app TOTP (already built)                                                                     | None                                   |
| Search                 | PostgreSQL full-text search and indexes                                                                    | None                                   |
| Analytics              | Built into the admin and business dashboards from transaction data                                         | None                                   |
| Jobs and notifications | Database outbox and job tables, run by Vercel Cron                                                         | Within the Vercel plan                 |
| Rate limiting          | PostgreSQL table instead of Redis                                                                          | None                                   |
| Malware scanning       | Open-source ClamAV, if it can be hosted within these limits; otherwise a production blocker (section 6)    | None, or blocked                       |
| Monitoring             | Vercel logs and the existing `/v1/metrics` endpoint and in-app health card; alerts by email through Resend | Within the plans above                 |

**Removed:**

- AWS, including hosting, RDS, S3 and Secrets Manager;
- Twilio and all paid SMS;
- paid monitoring, authentication, analytics, search, scheduling, queue, mapping and malware-scanning services.

The adapter interfaces stay in place:

- `ObjectStorage`, `MalwareScanner`, `Notifier`, the payment provider, and the planned logistics and maps adapters.

So a paid service can be added later behind configuration without code changes elsewhere, and only with founder approval.

### 2. No SMS

- **Sign-up and recovery:** customers verify and recover their account by email.
- **Admins:** keep authenticator-app TOTP, which is unchanged. Admin security is not weakened.
- **Phone numbers:** stay for delivery and appointment contact, and are marked unverified. Phone sign-in and phone one-time codes are switched off in production until a free or approved channel exists.
- **The existing SMS mock:** stays for local development and tests only.

### 3. Hosting on Vercel

| Vercel project  | What it serves                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jays-api`      | The NestJS API as one Node.js function, plus the cron routes                                                                                                                       |
| `jays-business` | Business portal (Next.js)                                                                                                                                                          |
| `jays-admin`    | Admin console (Next.js)                                                                                                                                                            |
| `jays-web`      | The customer app's web build (Expo web, static) and the legal pages. The iOS and Android apps are built with Expo and published through the stores; they are not hosted on Vercel. |

Staging and production are separate:

- Each project's **Preview** environment is staging and points at a separate Supabase project.
- **Production** is the production environment, with its own database, storage, keys and webhooks.
- With Supabase Free's limit of two active projects, the two are staging and production. Development uses the local Docker database.

### 4. What changes for serverless

The audit of the current code against Vercel's execution model found these issues. The business logic, database constraints, API contracts and tests stay as they are. Only the way processes start and the scheduling change.

| Area                    | Today                                                                                                                 | On Vercel                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API process             | Long-running NestJS server                                                                                            | The same Nest application, created once per function instance and reused across requests (Fluid compute). No route or contract changes. Cold starts add latency, measured in phase 10.                                                                                                                                                                                                                                   |
| In-process timers       | Notification dispatcher every 5 s; finance scheduler hourly                                                           | Off on Vercel (`SCHEDULERS=off`). The same code runs from protected cron routes.                                                                                                                                                                                                                                                                                                                                         |
| Worker                  | Separate process: expire unpaid orders and booking holds every 30 s, mark earnings eligible, finish account deletions | Each job becomes a cron route that calls the same database function. Vercel Pro allows cron at most **once per minute**. Correctness does not depend on the timer: the API already expires stale holds and reservations before it allocates new ones, so a minute's delay only affects how fast stale holds disappear from a dashboard.                                                                                  |
| Notifications           | Outbox dispatcher every 5 s                                                                                           | The request that commits an event also triggers a best-effort dispatch after the response. A cron sweep runs every minute. The outbox, its retries and the "at most once per channel" keys are unchanged.                                                                                                                                                                                                                |
| Redis                   | Login and request rate limits; a health check                                                                         | A PostgreSQL rate limiter (unlogged table, fixed window, atomic upsert), so no Redis subscription is needed. The in-memory limiter stays for tests.                                                                                                                                                                                                                                                                      |
| Database connections    | `pg.Pool` with up to 10 connections                                                                                   | Supabase's connection pooler (Supavisor) in **transaction mode** (port 6543), with a small pool per function instance (`DB_POOL_MAX`, default 3). The code uses only transaction-scoped features (row locks, `pg_advisory_xact_lock`, `SKIP LOCKED`), which transaction pooling allows. Migrations use the direct connection (port 5432).                                                                                |
| File uploads            | Signed direct upload to storage, then the API checks type, size and image shape and scans                             | Unchanged design. Supabase Storage signed upload URLs replace the local adapter. Files never pass through a function body, so the 4.5 MB body limit does not apply. The check reads the object from storage inside a function, which is limited by memory and duration (sections 5 and 6).                                                                                                                               |
| Payment webhooks        | Signed webhook route, idempotent processing                                                                           | Unchanged. Stripe retries failed deliveries, and processing stays idempotent.                                                                                                                                                                                                                                                                                                                                            |
| Concurrency protections | Database exclusion constraints, row locks, stock checks, append-only ledger triggers                                  | Unchanged. They live in PostgreSQL, so they hold whatever the number of function instances.                                                                                                                                                                                                                                                                                                                              |
| Metrics                 | Prometheus endpoint, in-process HTTP counters                                                                         | Database gauges stay meaningful. In-process HTTP counters are per instance and are no longer a reliable total, so Vercel's own request metrics replace them.                                                                                                                                                                                                                                                             |
| Backups                 | `pg_dump` script with encryption, plus a restore drill                                                                | Supabase Free has **no automatic backups**. A scheduled GitHub Actions workflow runs the existing encrypted `pg_dump` daily against the production database and keeps 30 days of copies as encrypted workflow artifacts. The passphrase is a GitHub secret. The restore drill runs monthly. GitHub Actions minutes are free for public repositories and limited for private ones; usage is tracked in the cost register. |

### 5. Regions and data residency

- **Supabase** has no Middle East region. The nearest are Mumbai (`ap-south-1`) and Frankfurt.
- **Vercel** has announced a Dubai region (`dxb1`). Functions should run next to the database, not next to the user, because every request makes several database round trips. The plan is to:
  - put the database in Mumbai;
  - run the API function in Mumbai (`bom1`);
  - serve static pages and cached public images from Vercel's edge network, which includes the region.
- **Customer data leaves the UAE.** Whether that is acceptable for the pilot and for production is a legal question, and is listed in the legal review checklist. JAYS does not process health data (D10).

### 6. Malware scanning

- **Why ClamAV cannot run in a Vercel function:**
  - Its signature database is a few hundred megabytes and needs regular `freshclam` updates.
  - It needs a lot of memory to load.
  - Vercel functions are short-lived, have a size limit on the deployed bundle, and have no persistent disk to keep updated signatures.
  - So it cannot run reliably inside a Vercel function.
- **Options that stay within the cost rules:**
  1. A small self-hosted ClamAV service on an always-free virtual machine, if one is available for commercial use. These usually need a credit card on file, so the founder must approve.
  2. A scan step in GitHub Actions. This is not suitable, because uploads must be scanned within seconds and the workflow minutes are limited.
  3. Supabase Storage has no built-in malware scanning on the free plan.
- **Until a real scanner runs, uploads are limited to what can be made safe without one:**
  - **Images** (product, storefront, review and support photos): checked by magic bytes and dimensions, then decoded and re-encoded server-side, which drops metadata and embedded content.
  - **Business documents** (licences, trade licences, IDs): stay in **quarantine**. Only compliance admins can see them, through short-lived signed links, with a warning that they were not scanned. They are never released to anyone else.
- Production still refuses to start with `MALWARE_SCANNER=mock` (ADR-0006). **Real malware scanning is a production blocker** until the founder approves one of the options above. Checking the file extension or type alone is not treated as enough.

### 7. Free-tier limits that matter first

Figures were checked on 28 November 2026; see the cost register for sources.

- **Resend Free: 100 emails a day and 3,000 a month.** The API sends only essential transactional and security email. Everything else is in-app or push. A daily counter refuses non-essential email when 80% of the daily allowance is used. Resend refuses mail over the limit (HTTP 429) without queueing it, so the outbox keeps the event and retries the next day. Security email always has priority.
- **Supabase Free:**
  - 500 MB database, 1 GB storage and 5 GB egress a month;
  - the project pauses after one week of inactivity;
  - no backups.

  Product images are therefore re-encoded to WebP at a bounded size. Public product images are served through the API with long cache headers, so the Vercel CDN (1 TB a month included on Pro) serves repeat views, not Supabase egress. A usage card on the admin dashboard shows database size, storage size and email counts against the limits.

- **Vercel Pro:**
  - functions run 300 s by default and 800 s at most;
  - request and response bodies are limited to 4.5 MB;
  - cron runs at most every minute;
  - a $20 usage credit is included.

  Spend management alerts are set, and nothing turns on overages beyond the plan without approval.

## Consequences

- Sections 4, 6 and 7 describe the target design. The rate limiter, cron routes, pool settings, image re-encoding, email budget, usage card and backup workflow are built in phases 9 and 10. [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md) tracks what exists.

- Phase 10 is now "Vercel deployment architecture": configuration, cron routes, the PostgreSQL rate limiter, the connection pool settings, the backup workflow and the usage card. Nothing is deployed without approval.
- Phase 9 builds the Stripe (test mode), Resend, FCM and Supabase Storage adapters. Tests that use mocks and tests that call a real provider are labelled separately. No real-provider result is claimed without credentials.
- **Production blockers:**
  - malware scanning (section 6);
  - data residency (section 5);
  - Supabase Free's lack of backups, which the GitHub workflow covers but which needs the founder's approval of where backups are kept;
  - the free-tier limits once the pilot grows (see the scale estimates in the cost register).
- The Docker image and staging compose file from ADR-0017 stay for local development and CI. They are no longer the deployment target.
