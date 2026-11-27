# Implementation status

Plan: [implementation-plan.md](implementation-plan.md). Decisions: [adr/](adr/README.md).

| Phase | Scope                                                        | Status                              |
| ----- | ------------------------------------------------------------ | ----------------------------------- |
| 0     | Monorepo, local Docker, env schema, CI, ADRs                 | In review                           |
| 1     | Identity, roles, memberships, bilingual gateway              | Not started                         |
| 2     | Merchant onboarding, approval, categories, media, storefront | Not started                         |
| 3     | Catalog, inventory, cart, multi-seller checkout (mock PSP)   | Not started                         |
| 4     | Services, staff, availability, booking holds                 | Not started                         |
| 5     | Real PSP sandbox, ledger, refunds, payouts, reconciliation   | Blocked on founder decisions D3, D5 |
| 6     | Fulfillment, reviews, support, notifications, dashboards     | Not started                         |
| 7     | RTL/accessibility, hardening, backups, observability, pilot  | Not started                         |

## Phase 0: Foundation

Date: 2026-11-27. Branch: `phase-0/scaffold`.

### Delivered

- pnpm workspace with 5 apps and 6 packages, strict TypeScript 6.0, ESLint 10, Prettier, Vitest 5.
- `apps/api`: NestJS 12 with `/v1/health` and `/v1/health/ready`, request IDs, redacted structured logs, error envelope, helmet, CORS allow-list, env validation at boot, generated OpenAPI 3.1 (`apps/api/openapi.json`).
- `apps/worker`: validated env, Redis check, structured logs, graceful shutdown. No job handlers yet.
- `apps/business`, `apps/admin`: Next.js 16 foundation pages with English/Arabic and RTL from cookie or Accept-Language.
- `apps/customer`: Expo SDK 58 foundation screen using device language and RTL.
- `packages/config`: environment schema with production guards (no mock PSP, no dev switches, no committed example secrets).
- `packages/domain`: integer-fils money with explicit rounding, modes, roles, timezone helpers.
- `packages/contracts`, `packages/i18n`, `packages/ui`: error/pagination/health contracts, en/ar catalogs, design tokens with WCAG AA contrast tests.
- `packages/db`: forward-only SQL migration runner (advisory lock, per-file transaction, checksum enforcement) and `0001_extensions.sql`.
- Docker Compose (PostgreSQL 17, Redis 7, separate `jays_test` database), CI (verify, integration, security), ADRs 0001–0008.

### Verified locally (2026-11-27)

| Command                                                    | Result                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                        | pass                                                                                                                      |
| `pnpm lint`                                                | pass, 11 projects                                                                                                         |
| `pnpm typecheck`                                           | pass, 11 projects                                                                                                         |
| `pnpm test`                                                | pass, 74 unit tests                                                                                                       |
| `pnpm build`                                               | pass (packages, API, worker, both Next.js apps)                                                                           |
| `pnpm openapi:check`                                       | pass                                                                                                                      |
| `pnpm db:migrate` on empty `jays_test`, then again         | applied 0001, then "database is up to date"                                                                               |
| `pnpm test:integration`                                    | pass, 6 tests (extensions, idempotency, exclusion constraint, runner safety, API readiness against real Postgres + Redis) |
| `curl localhost:3000/v1/health/ready` with the API running | `200 {"status":"ready","checks":{"database":"up","redis":"up"}}`                                                          |

### Not in this phase

- Seed data: there are no domain tables yet; seeds start in phase 1.
- Screenshots: the web and mobile foundation pages show only the surface name and a "features arrive in later phases" notice; real screens and screenshots start in phase 1.
- The Expo app is type-checked, linted and unit-tested in CI but not built into a binary (EAS builds come with the first real screens).

### Rollback

Phase 0 adds no domain tables. `0001_extensions.sql` only creates extensions; dropping the local database or `docker compose down -v` resets everything.
