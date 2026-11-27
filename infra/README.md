# Infrastructure

Phase 0 contains local development infrastructure only:

- `../docker-compose.yml`: PostgreSQL 17 and Redis 7 bound to 127.0.0.1.
- `postgres/init/`: runs once when the Postgres volume is first created; creates the `jays_test` database used by integration tests.

Staging and production infrastructure (hosting, secret manager, backups with tested restore, observability) is phase 7 and depends on decisions recorded in `docs/adr/0007-founder-decisions-and-mvp-defaults.md`.
