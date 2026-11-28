# Operations runbook

What to do when an alert in [alerts.yml](alerts.yml) fires. Design and limits: [ADR-0017](../../docs/adr/0017-hardening-observability-backups.md).

Every API log line is JSON with a `reqId`; the same id is returned in the `x-request-id` response header, so a customer or merchant report can be traced to its log lines. Admin actions are in the audit log (admin console, or the `audit_log` table).

## ApiDown

The API stopped answering scrapes.

1. Check `GET /v1/health` (process up) and `GET /v1/health/ready` (PostgreSQL and Redis reachable).
2. If the process will not start, read the first log lines: an invalid environment is reported as `Invalid environment:` followed by the variable names (values are never printed). Production refuses mock providers, http URLs and committed example secrets by design (ADR-0006).
3. If `ready` reports a dependency down, fix that dependency first. Notifications and daily reconciliation run inside the API, so they pause until it is back; nothing is lost because the outbox and reconciliation catch up.

## ApiHighErrorRate

1. Group `jays_http_requests_total{status=~"5.."}` by `route` to find the failing endpoint.
2. Search the logs for `"level":50` on that route and follow the `reqId`.
3. A spike on `/v1/webhooks/payments` usually means the provider is sending something we refuse; check the webhook secret rotation before anything else. Webhooks are retried by the provider and are idempotent here.

## ApiSlowReads

1. Find the slow route: `histogram_quantile(0.95, sum by (le, route) (rate(jays_http_request_duration_seconds_bucket{method="GET"}[10m])))`.
2. Check database load and slow queries (`pg_stat_statements` if enabled).
3. Compare against the baseline in `docs/IMPLEMENTATION_STATUS.md` (phase 7 load test). Re-run `node scripts/load/read-load.mjs` against staging after a fix.

## NotificationQueueLagging

The outbox dispatcher runs every 5 seconds in each API instance.

1. Admin console, Notifications: look at pending, retrying and failed counts and the last error.
2. Retrying events back off up to 1 hour each; a provider outage shows as many retries with the same error. The events go out once the provider recovers.
3. If nothing is retrying but events are old, the dispatcher is not running: check that at least one API instance is up and not in `APP_ENV=test`.

## NotificationsFailed

An event used all 6 attempts. The admin Notifications page shows the error. Fix the cause (template, address, provider), then retry the event from that page. Retries never duplicate a message already sent: deliveries are unique per event, user and channel.

## ExpiredHoldsNotReleased

Expired booking holds (10 minutes) or stock reservations (payment window) are still blocking sales, which means the sweepers are not running or are failing. The worker (`apps/worker`) runs both every 30 seconds. The API also runs a small batch just before it reserves stock or holds a slot, so the problem can stay hidden while checkout traffic is high.

1. Check that the worker is running and read its logs for `expire-unpaid-orders` or `expire-booking-holds` errors.
2. The sweeps are plain SQL functions and safe to run by hand:
   `SELECT expire_booking_holds(now(), 100);` and `SELECT expire_unpaid_orders(now(), 100);`
3. Never release a hold by editing rows directly: the functions also write events and restock correctly.

## PaymentsNeedAttention

A payment or payout is flagged (`needs_attention`), usually a late capture on an expired order, a failed refund, or a failed payout.

1. Admin console, Finance: open the flagged item; the reason is recorded on it.
2. Late payments for expired orders are refunded through the normal refund flow (second approver above the threshold).
3. Failed payouts return funds to the business balance; retry after the business fixes its bank details at the provider.

## ReconciliationMismatch

1. Admin console, Finance, Reconciliation: each open item shows the local and provider amount or status.
2. `recovered_missing_webhook` items are fixed automatically and do not raise this alert.
3. Resolve each item with a note once the cause is understood. Do not edit payments or ledger rows by hand: the ledger is append-only and corrections are new entries.

## ReconciliationNotRunning

Reconciliation runs daily from the finance scheduler in the API. Start a run from the admin console to catch up; runs are unique per provider and period, so a repeat is refused rather than duplicated.

## SupportTicketsOverdue

Tickets waiting past the 24-hour first-reply SLA (assumption D12). Admin console, Support, filter "Overdue". Assign and reply; a reply clears the overdue state.

## BackupMissing

The nightly `infra/backup/backup.sh` has not succeeded for 26 hours.

1. Read the job's log; the script exits non-zero and leaves no partial file on failure.
2. Common causes: wrong `PG_DUMP` major version for the server, the passphrase file missing, or the backup volume full.
3. Run the job by hand once fixed, then run the restore drill (`infra/backup/drill.sh`) against a scratch server.

## Backup schedule

Run `infra/backup/backup.sh` daily with `BACKUP_METRICS_FILE` pointing at the node_exporter textfile directory. Keep at least 30 daily backups in storage separate from the database host, and keep the passphrase only in the secret manager. Once a month, run `infra/backup/drill.sh` (or a manual restore) against the latest backup on a scratch server and record the result.

## Restoring a backup

1. Provision an empty database on the same PostgreSQL major version.
2. Fetch the `.dump.enc` and its `.sha256` from backup storage, and the passphrase from the secret manager.
3. `TARGET_DATABASE_URL=… BACKUP_PASSPHRASE_FILE=… infra/backup/restore.sh jays-<stamp>.dump.enc`. The script checks the checksum, refuses a non-empty target, and restores in one transaction, so a failure leaves the target empty.
4. Point a staging API at the restored database and check `GET /v1/health/ready` before switching traffic.
5. Payments made after the backup exist only at the provider: run reconciliation for the gap so missing payments are recovered from the provider's records.
