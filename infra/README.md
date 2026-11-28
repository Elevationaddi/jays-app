# Infrastructure

| Path                    | What it is                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `../docker-compose.yml` | Local development only: PostgreSQL 17 and Redis 7 bound to 127.0.0.1.                                        |
| `postgres/init/`        | Runs once on a new local volume; creates the `jays_test` database for integration tests.                     |
| `../Dockerfile`         | Images for `api`, `worker`, `business` and `admin` (`docker build --target api .`). Built and started in CI. |
| `staging/`              | Single-host staging stack (compose, env example). Mock adapters allowed; production refuses them.            |
| `backup/`               | Encrypted `pg_dump` backup, checked restore, and a restore drill that CI runs on every push.                 |
| `observability/`        | Prometheus alert rules, example scrape config, and the operations runbook.                                   |

Design and open decisions: [ADR-0017](../docs/adr/0017-hardening-observability-backups.md).

## Staging

```sh
cp infra/staging/staging.env.example infra/staging/staging.env      # replace every CHANGE_ME
printf '%s' 'the-postgres-password' > infra/staging/postgres_password.txt
docker compose -f infra/staging/docker-compose.yml up -d --build
```

Use the same database password in `postgres_password.txt` and in `DATABASE_URL`. Both files are gitignored. Put a TLS reverse proxy in front of ports 3000 to 3002. To seed fictional demo data, run `docker compose -f infra/staging/docker-compose.yml run --rm api node dist/scripts/seed.js`.

## Backups

```sh
DATABASE_URL=… BACKUP_PASSPHRASE_FILE=/run/secrets/backup-passphrase BACKUP_DIR=/backups infra/backup/backup.sh
TARGET_DATABASE_URL=… BACKUP_PASSPHRASE_FILE=… infra/backup/restore.sh /backups/jays-<stamp>.dump.enc
DATABASE_URL=postgresql://jays:jays@localhost:5432/jays_test infra/backup/drill.sh
```

The client tools must match the server's major version. Set `PG_DUMP`, `PG_RESTORE` and `PSQL` to use a container instead, as CI does.

## Monitoring

Scrape `GET /v1/metrics` with `authorization: Bearer $METRICS_TOKEN` (see `observability/prometheus.example.yml`) and load `observability/alerts.yml`. The runbook explains each alert.

## Checks you can run locally

- `node scripts/a11y/audit.mjs`: axe-core accessibility audit of both portals in English and Arabic (needs the seeded stack running and Playwright).
- `node scripts/load/read-load.mjs`: read load test with a p95 target (`CONCURRENCY`, `DURATION_S`, `P95_TARGET_MS`).
