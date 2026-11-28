# ADR-0017: Hardening, observability, backups and staging

Status: Accepted (engineering). Hosting, the alerting tool and the on-call rota are not decided. This ADR keeps everything portable to any container host with Prometheus-compatible monitoring.

Date: 2026-11-28

## Context

Phase 7 (docs/10-build-plan.md) asks for:

- an RTL and accessibility audit (T11);
- concurrency and security tests;
- a load test against the target of p95 read under 500 ms at pilot load;
- daily backups with a tested restore (T12);
- observability: request ids, error rates, p95, queue lag, expired holds, reconciliation mismatches and alerts;
- a staging environment and a pilot.

No hosting provider has been chosen, and production is blocked anyway by the founder decisions in ADR-0007.

## Decision

### Metrics

- `GET /v1/metrics` serves the Prometheus text format. It is protected by a bearer token (`METRICS_TOKEN`, at least 32 characters, compared in constant time).
- Without a token the endpoint returns 404. Production refuses to start without one.
- The endpoint is left out of the public OpenAPI document.
- HTTP metrics are kept in process:
  - `jays_http_requests_total{method,route,status}`;
  - `jays_http_request_duration_seconds` histogram, with a bucket at 0.5 s for the p95 target.
- The `route` label is the matched route pattern (`/v1/stores/:storeId`), and `unmatched` for unknown paths, so ids and probing never create new series.
- Operational gauges are read from the database at scrape time, with one query:
  - outbox pending, failed, and age of the oldest pending event;
  - booking holds and stock reservations still active more than 2 minutes after expiry;
  - payments needing attention and payout exceptions;
  - open reconciliation findings, and the time of the last completed reconciliation;
  - overdue support tickets and open disputes.
- We wrote a small registry instead of adding `prom-client`, because we need only counters, one histogram and gauges.

Request ids already exist (phase 0). Every log line carries `reqId`, which is echoed in `x-request-id`.

### Alerts and runbook

`infra/observability/alerts.yml` holds 11 Prometheus rules:

- API down, 5xx rate above 2%, and read p95 above 500 ms;
- notification lag and failed notifications;
- expired holds not released;
- payments needing attention;
- reconciliation mismatches, and reconciliation not running;
- overdue tickets;
- a missing backup.

Each rule links to a section of `infra/observability/RUNBOOK.md`.

Admins can now list failed notification events and queue them again (`notifications.manage`, audited as `notification.retried`). The runbook depends on this. A retry never sends a message twice, because deliveries are unique per event, user and channel (ADR-0016).

### Backups

`infra/backup/backup.sh` streams `pg_dump --format=custom` through `openssl enc -aes-256-cbc -pbkdf2` (200,000 iterations) and writes a SHA-256 file beside the dump.

- The passphrase comes from a file, which belongs in the secret manager.
- A failed dump leaves no file behind.
- The script can write a node_exporter textfile with the time of the last successful backup, which feeds the `BackupMissing` alert.

`restore.sh` restores in one transaction:

- it checks the checksum first;
- it refuses a target database that is not empty;
- a failure leaves the target empty.

`drill.sh` runs the full cycle:

1. It backs up, then restores into a fresh scratch database.
2. It compares the exact row count of every table and the list of applied migrations.
3. It checks that the ledger balances and that the append-only triggers survived.

CI runs the drill on every push after the integration tests, with PostgreSQL 17 client tools.

The schedule (daily) and retention are deployment settings. The runbook says to keep at least 30 daily backups and to run the drill monthly against the latest one.

### Concurrency and timezone tests

New integration tests send parallel requests against real PostgreSQL:

- a merchant ships while the customer cancels: exactly one wins, and stock and refunds match the winner;
- five identical fulfillment steps: one applies and four get 409;
- four identical return requests: one is created;
- four reviews of the same item: one is recorded.

Earlier phases already cover the last unit (T04), double booking (T07), refund caps (T09) and approval by separate actors (T16).

T14 unit tests pin the Dubai midnight boundaries of dashboard ranges: 23:59:59 and 00:00 local, New Year, a leap day, and the default range just after midnight.

### Accessibility audit

`scripts/a11y/audit.mjs` signs in to both portals with seed accounts and runs axe-core on every workspace page in English and Arabic. It applies the WCAG 2.0 and 2.1 A and AA rules, and also checks:

- that the Arabic pages are `dir="rtl"`;
- that no page redirected away, for example to sign-in.

Result on 2026-11-28: 74 page views, 0 violations of any severity.

The customer app is not covered. Expo screens need a device or simulator audit, which is listed as a follow-up.

### Load test

`scripts/load/read-load.mjs` runs N virtual users against the public read endpoints: product list, search and detail, categories, stores, venue detail and availability. It exits non-zero above the p95 target.

Result on 2026-11-28 (one API process, 4 vCPU, local PostgreSQL, seed data), with 50 users for 30 s:

- 16,111 requests at 536 requests per second;
- p95 218 ms overall;
- the slowest endpoint is availability, at p95 264 ms;
- no failures.

The dataset is small. The test must be repeated on staging with pilot-sized data before the pilot.

### Staging

- One `Dockerfile` with the targets `api`, `worker`, `business` and `admin`, built from the workspace on Node 22 (Debian slim) and run as the `node` user. No secrets are baked into the images.
- `infra/staging/docker-compose.yml` runs the whole stack on one host:
  - a one-shot `migrate` service runs first;
  - PostgreSQL gets its password through a Docker secret;
  - all ports are bound to 127.0.0.1, behind a TLS proxy.
- `APP_ENV=staging` still allows the mock payment, email, storage and scanner adapters, so a pilot can run end to end without real money.
- CI builds every image, migrates a real database with the API image, starts the API, worker and business portal, checks readiness and metrics, and loads the sign-in page.

The images carry the built workspace, including development dependencies. They are simple and work everywhere, at the cost of size. Pruning them (`pnpm deploy`, Next.js standalone output) is a later optimisation.

## Assumptions needing a decision

- **Hosting and region:** not chosen. UAE data residency may matter for payments and personal data (docs/09). The staging compose works on any VM.
- **Alerting destination and on-call:** the rules exist, but who is paged, and how, is not decided.
- **Backup storage and retention:** the scripts are storage-agnostic. A bucket in the chosen cloud with 30 daily copies is assumed.
- **Pilot scope:** which merchants, which emirates (D11) and how long. Not decided, so no pilot was started.

## Consequences

- Operators can see stuck holds, queue lag and money problems before customers report them, and each alert says what to do.
- A broken backup or restore fails CI, not an incident.
- Production still cannot start until the real payment, email and storage adapters exist and the founder decisions are made (ADR-0006, ADR-0007).
