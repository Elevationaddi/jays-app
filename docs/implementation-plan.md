# Phased implementation plan

Status: proposed, 27 November 2026. Source: `docs/10-build-plan.md`, with acceptance tests T01–T16 from `docs/09-security-testing.md`.
Progress is recorded in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md). Decisions and assumptions are in [`adr/`](adr/).

## Starting point

The repository was empty apart from the specification package. There was no existing code to preserve.
The spec files are committed unchanged; the combined specification and storyboard PDF live in `reference/` so that
`docs/*.md` stays the numbered source of truth.

## Rules that apply to every phase

- A phase is done only when its gate passes: SQL migrations, seed data, unit and integration tests (integration tests use a real PostgreSQL), screenshots for any UI, green CI, regenerated OpenAPI, and an updated README and status file.
- No later phase is started to hide a failing earlier gate.
- Payment, availability, authorization and fulfillment are never faked. Local development uses mock provider adapters that behave like the real ones (asynchronous webhooks, failures, duplicates). Mock adapters refuse to start in production.
- Every proposed default that is really a commercial or legal decision stays configurable and is listed in [ADR-0007](adr/0007-founder-decisions-and-mvp-defaults.md) until the founder approves it.

## Phases

### Phase 0: Foundation (merged)

Monorepo scaffold, local Docker, environment schema, lint/typecheck/test CI, ADRs.

| Deliverable                                                                                                                                                                                                                | Where                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| pnpm workspace, strict TypeScript, ESLint, Prettier, Vitest                                                                                                                                                                | repo root, `packages/config` |
| Apps: `api` (NestJS, `/v1/health`, `/v1/health/ready`), `worker`, `business` and `admin` (Next.js), `customer` (Expo)                                                                                                      | `apps/*`                     |
| Shared packages: `config` (env schema), `domain` (money, modes, roles, time), `contracts` (error envelope, pagination, health), `i18n` (en/ar, RTL), `ui` (design tokens with contrast tests), `db` (SQL migration runner) | `packages/*`                 |
| Local PostgreSQL 17 and Redis via Docker Compose                                                                                                                                                                           | `docker-compose.yml`         |
| Baseline migration: `pgcrypto`, `citext`, `btree_gist`; integration test proving a staff-overlap exclusion constraint works                                                                                                | `packages/db`                |
| Request IDs, structured logs with secret redaction, standard error envelope                                                                                                                                                | `apps/api`                   |
| OpenAPI generated from code and checked for drift in CI                                                                                                                                                                    | `apps/api/openapi.json`      |
| CI: format, lint, typecheck, unit tests, build, OpenAPI drift; migrations and integration tests on PostgreSQL + Redis; secret scan and dependency audit                                                                    | `.github/workflows/ci.yml`   |

Gate: all CI jobs green; `docker compose up` gives healthy Postgres and Redis; `pnpm db:migrate` applies to an empty database; `/v1/health/ready` reports both dependencies.
No seed data yet, because there are no domain tables. Seeds begin in phase 1.

### Phase 1: Identity, roles, memberships, bilingual gateway

Delivered on branch `claude/project-thread-i0hr4p`. Decisions: [ADR-0009](adr/0009-identity-and-sessions.md) (identity and sessions), [ADR-0010](adr/0010-authorization-and-admin-mfa.md) (authorization and admin MFA), [ADR-0011](adr/0011-web-sessions-bff-cookies.md) (web sessions and CSRF).

| Deliverable                                                                                                                                                                                      | Where                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Migration `0002_identity.sql`: emirates (seeded), users, verification challenges, sessions, addresses, businesses, memberships, business modes, admin accounts/roles/sessions, audit log, outbox | `packages/db/migrations`                                   |
| Kysely table types with a drift test against the live schema                                                                                                                                     | `packages/db/src/schema.ts`                                |
| Register, verify (email or UAE mobile), resend, login, refresh with rotation and reuse detection, logout, password reset; Argon2id; OTP expiry, attempt limits and Redis rate limits             | `apps/api/src/auth`                                        |
| Profile, language, emirate, preferred mode, marketing consent, addresses (archive, one default), my memberships with accept/decline                                                              | `apps/api/src/me`                                          |
| Businesses (draft shell), mode activation, team management with capability checks and last-owner protection                                                                                      | `apps/api/src/businesses`, `packages/domain/src/access.ts` |
| Invite-only admins with mandatory TOTP, platform roles, admin list/invite, audit log viewer                                                                                                      | `apps/api/src/admin`                                       |
| Shared request/response schemas (validation and OpenAPI) and a typed API client                                                                                                                  | `packages/contracts`, `packages/api-client`                |
| Customer app: welcome with Shop Products / Book Services, manual or location-suggested emirate, persistent mode switch, sign in/up, verify, reset, account                                       | `apps/customer`                                            |
| Business portal: sign in/up, verify, workspace gateway with mode cards and onboarding state, start a business, team management, invitations                                                      | `apps/business`                                            |
| Admin console: sign in with TOTP, invite acceptance and authenticator enrolment, admin accounts, audit log                                                                                       | `apps/admin`                                               |
| English and Arabic (RTL) on all three surfaces                                                                                                                                                   | `packages/i18n`                                            |
| Fictional seed data and helper scripts (`db:seed`, `totp`, `admin:bootstrap`)                                                                                                                    | `apps/api/scripts`                                         |

Acceptance coverage in this phase:

- **T03 (role boundaries):** clients cannot send role or status fields, business A is invisible to members of business B, staff without a capability get 403, invitees have no access until they accept, removal cuts access at once, user and admin tokens are not interchangeable, and platform roles are enforced on every admin endpoint.
- **Auth expiry and rate limits:** code expiry, attempt lockout, resend cooldown, send limits, login and registration limits, 15-minute access tokens, 30-day idle sessions, refresh reuse and concurrent refresh.
- **T01 (part):** the mode switch keeps the selected mode across sign-in (reducer tests and screenshots `customer-04` and `customer-07`).
- **T11 smoke:** every screen renders in Arabic with `dir="rtl"`, and catalog parity tests check that both languages define the same keys and placeholders.

### Phase 2: Merchant onboarding, approval, categories, media, storefront

Delivered on branch `claude/project-thread-eooims`. Decision: [ADR-0012](adr/0012-merchant-onboarding-storage-and-review.md) (onboarding, private files and admin review).

| Deliverable                                                                                                                                                          | Where                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Migration `0003_merchant_onboarding.sql`: legal profile and review columns, verification documents, media, storefronts (draft and live), categories (seeded), brands | `packages/db/migrations`                        |
| Business and mode state machines, review action allowlist and capabilities, submission checklist, file rules (magic bytes, sizes, image dimensions)                  | `packages/domain/src/onboarding.ts`, `files.ts` |
| Storage and malware scanner adapters (local signed links, mock EICAR scanner), production guards                                                                     | `apps/api/src/storage`, `packages/config`       |
| Merchant onboarding, documents, storefront and media endpoints                                                                                                       | `apps/api/src/onboarding`                       |
| Admin review queue, detail, audited document download, typed actions with reasons and version checks                                                                 | `apps/api/src/admin/admin-businesses.*`         |
| Public categories, brands, approved stores and store images; admin taxonomy                                                                                          | `apps/api/src/catalog`                          |
| Business portal Verification and Storefront pages                                                                                                                    | `apps/business`                                 |
| Admin console business review and categories and brands                                                                                                              | `apps/admin`                                    |
| Customer app categories, approved stores and store page                                                                                                              | `apps/customer`                                 |
| Seeds: 2 product sellers, 1 salon, 1 hybrid (approved), 1 in review, 1 draft, with English and Arabic storefronts                                                    | `apps/api/scripts`                              |

Acceptance coverage in this phase:

- **T02:** a submitted or under-review merchant is not listed and its images answer 404; after approval only the live copy is public; suspension hides the store at once and reactivation restores it; storefront edits after approval wait for review while the live copy stays public.
- **Audit and concurrency:** every review action and document download writes an audit entry; two reviewers acting on the same version cannot both win.
- **T03 (extended):** each admin role can take only its own review actions; documents are limited to the owner and compliance roles; one business cannot use another's media.

### Phase 3: Catalog, inventory, cart, multi-seller checkout (mock PSP)

- Products, variants (unique SKU per business), stock movements, CHECK constraints `stock_on_hand >= stock_reserved >= 0`.
- Cart (survives login and mode switch), server-priced expiring quote, `POST /orders` locking variant rows in stable ID order, reservations with expiry worker.
- Mock PSP adapter with success, fail, timeout, duplicate outcomes delivered as signed webhooks; idempotency keys.
- Tests: T04, T05, T06 (mock), T13 for products, T01 (cart kept on login).

### Phase 4: Services, branches, staff, availability, booking holds

- Services, branches, hours, closures, staff, shifts, blocks, staff-service/branch assignment.
- Availability engine (15-minute grid, buffers, UTC storage, Asia/Dubai display) and exclusion constraint on staff intervals for held/confirmed/checked_in.
- Hold (10 minutes), pay via mock PSP, confirm on verified webhook, any-staff deterministic allocation, atomic reschedule, cancellation policy snapshot, merchant calendar with manual bookings.
- Tests: T07, T08, T14, T13 for services, T09 cancellation boundaries.

### Phase 5: Real PSP sandbox, ledger, refunds, payouts, reconciliation

- PSP adapter for the founder-chosen provider in sandbox, raw-body webhook signature verification, replay protection.
- Balanced immutable ledger, effective-dated fee rules, refunds (partial, two-approver threshold), payout eligibility and holds, daily reconciliation job.
- Blocked until the founder picks the PSP and merchant-of-record model (ADR-0007).
- Tests: T06 (real sandbox), T09, T15, T16.

### Phase 6: Fulfillment, reviews, support, notifications, dashboards, exports

- Shipments and tracking, returns workflow, reviews with moderation, support tickets with internal notes, notification templates and outbox delivery with retry, admin/business dashboards and logged exports.
- Tests: T10, T12 (notification retry), dashboard metric definitions.

### Phase 7: Hardening and pilot

- RTL and accessibility audit, concurrency and security tests, load test (p95 read < 500 ms target), backups with tested restore, observability (request IDs, error rates, p95, queue lag, expired holds, reconciliation mismatches, alerts), staging environment and pilot.
- Tests: T11, T12, full regression of T01–T16.

## Founder decisions that block later phases

See [ADR-0007](adr/0007-founder-decisions-and-mvp-defaults.md). None block phases 0–4; the PSP and merchant-of-record decisions block phase 5, and all of them block production.
