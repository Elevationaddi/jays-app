# ADR-0004: Plain SQL migrations; Kysely instead of Prisma

- Status: Accepted (reversible until phase 1 tables exist)
- Date: 2026-11-27

## Context

The spec proposes "PostgreSQL + Prisma with raw SQL migrations for range constraints". The core invariants are expressed in SQL features that Prisma's schema language does not model: a `btree_gist` exclusion constraint on `(staff_id, tstzrange(occupied_start, occupied_end))` filtered by booking status, `CHECK (stock_on_hand >= stock_reserved AND stock_reserved >= 0)`, partial unique indexes, composite same-merchant foreign keys and deferred ledger balance checks. Checkout also needs `SELECT … FOR UPDATE` on variant rows in a stable order.

With Prisma these would live in hand-edited migrations that Prisma's schema does not know about, so its drift detection and generated types would be partly wrong.

## Decision

- **Migrations are plain, forward-only SQL files** in `packages/db/migrations/NNNN_name.sql`, applied by a small runner in `packages/db` that takes a PostgreSQL advisory lock, runs each file in its own transaction, records a SHA-256 checksum, and refuses to start if an applied file was edited or the database is ahead of the code.
- **Query layer: Kysely** (typed SQL query builder), introduced in phase 1 with types generated from the live schema. It keeps row locks, CTEs and range types first-class.
- Phase 0 ships only `0001_extensions.sql` (`pgcrypto`, `citext`, `btree_gist`) plus an integration test that proves the staff-overlap exclusion constraint works and ignores canceled rows.

## Consequences

- SQL is the single source of truth for the schema; reviewers read exactly what runs.
- No ORM conveniences (nested writes, automatic relations); repository functions are written explicitly.
- Rollback is by a new forward migration. Each phase's status entry notes how to roll back.
- If the team prefers Prisma, switch before phase 1 creates tables: replace the runner with Prisma Migrate and keep the SQL files as its baseline.
