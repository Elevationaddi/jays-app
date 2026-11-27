# Implementation status

Plan: [implementation-plan.md](implementation-plan.md). Decisions: [adr/](adr/README.md).

| Phase | Scope                                                        | Status                              |
| ----- | ------------------------------------------------------------ | ----------------------------------- |
| 0     | Monorepo, local Docker, env schema, CI, ADRs                 | Merged (PR #1)                      |
| 1     | Identity, roles, memberships, bilingual gateway              | Merged (PR #2)                      |
| 2     | Merchant onboarding, approval, categories, media, storefront | In review                           |
| 3     | Catalog, inventory, cart, multi-seller checkout (mock PSP)   | Not started                         |
| 4     | Services, staff, availability, booking holds                 | Not started                         |
| 5     | Real PSP sandbox, ledger, refunds, payouts, reconciliation   | Blocked on founder decisions D3, D5 |
| 6     | Fulfillment, reviews, support, notifications, dashboards     | Not started                         |
| 7     | RTL/accessibility, hardening, backups, observability, pilot  | Not started                         |

## Phase 2: Merchant onboarding, approval, categories, media, storefront

Date: 2026-11-27. Branch: `claude/project-thread-eooims`. Decision: [ADR-0012](adr/0012-merchant-onboarding-storage-and-review.md). Detail: [implementation plan](implementation-plan.md#phase-2-merchant-onboarding-approval-categories-media-storefront).

### Delivered

- Migration `0003_merchant_onboarding.sql`: legal profile, address, agreement, review and suspension columns plus a version counter on `businesses`; per-mode review columns; new tables `verification_documents`, `media`, `storefronts` (draft and live copies), `categories` (one mode, at most three levels, depth set by trigger) and `brands`. The MVP category tree is seeded in English and Arabic, without medical categories (D10).
- API (54 paths under `/v1`, up from 31):
  - Merchant onboarding: legal profile, agreement acceptance, private document upload, check, download and removal, submission with a server-side checklist.
  - Storefront editing with logo and banner uploads; after approval, edits wait for review while the live copy stays public.
  - Admin review queue and detail, audited document downloads, and nine typed review actions with reasons, a version precondition, row locks, audit entries and outbox events.
  - Admin categories and brands; public categories, brands, approved stores and store images.
- Files: signed upload tickets, real type from magic bytes, size and image dimension rules, a malware scanner adapter (mock flags EICAR), refused files deleted. Local storage adapter with HMAC-signed links; production refuses the local storage and mock scanner.
- Business portal: Verification page (legal details, documents, payouts note, agreement, checklist, modes, submit or resubmit), Storefront page (both languages, logo and banner, preview, pending and rejected notices), and shared workspace tabs.
- Admin console: business review queue with status filters, business detail with legal profile, documents, submitted and live storefront, history and only the decisions the reviewer's role allows; categories and brands.
- Customer app: categories and approved stores on each mode's home, and a store page. Nothing appears before approval.
- Seed data: Noor Beauty Supply (shop), Lumière Salon (services) and Oud & Bloom (hybrid) approved and public; Saffron Skin Co. waiting in the review queue; Amber Atelier as an empty draft to try the forms. Subcategories and three fictional brands.
- Screenshots: [`docs/screenshots/phase-2/`](screenshots/phase-2/) (14 screens, English and Arabic RTL, phone and desktop).

### Verified locally (2026-11-27)

| Command                                            | Result                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`                                | pass                                                            |
| `pnpm lint`                                        | pass, 12 projects                                               |
| `pnpm typecheck`                                   | pass, 12 projects                                               |
| `pnpm test`                                        | pass, 144 unit tests                                            |
| `pnpm build`                                       | pass (packages, API, worker, both Next.js apps)                 |
| `pnpm openapi`                                     | 54 paths; committed with the code                               |
| `pnpm db:migrate` on an empty database, then again | applied 0001 to 0003, then "database is up to date"             |
| `pnpm test:integration`                            | pass, 74 tests (15 database, 59 API against Postgres and Redis) |
| `pnpm db:seed`, run twice                          | idempotent; refuses `APP_ENV=production`                        |

Acceptance coverage: **T02** (a pending merchant is invisible, an approved one shows only live content, suspension hides it at once and reactivation restores it), audit entries for every review action and document read, concurrent reviewer decisions (only one wins), role boundaries for each admin action, cross-business media refused by the API and the database, and upload refusals (wrong type, infected, oversize, tampered or expired links).

### Known limitations and follow-ups

- Production storage (S3-compatible) and a real malware scanner are not implemented. Production refuses to start without them, so this blocks deployment until the hosting decision is made.
- Bank and PSP onboarding is not collected until the provider is chosen (D5). The portal says so.
- The merchant agreement text and version are placeholders (`merchant-draft-2026-11`, D13).
- Expired pending uploads are not cleaned up yet (worker job later). Documents are reviewed with the business, not one by one. A licence that expires after approval does not yet trigger reminders or suspension.
- The portals relay uploads through their own server instead of uploading straight from the browser.
- Arabic copy for this phase needs review by a native speaker before the pilot.

### Rollback

`0003_merchant_onboarding.sql` adds columns with defaults and new tables only. Rolling back means deploying the previous code; the new columns and tables are ignored by it. Uploaded files live under `STORAGE_LOCAL_DIR` locally and can be deleted with the database.

## Phase 1: Identity, roles, memberships, bilingual gateway

Date: 2026-11-27. Branch: `claude/project-thread-i0hr4p`. Merged in PR #2. Decisions: [ADR-0009](adr/0009-identity-and-sessions.md), [ADR-0010](adr/0010-authorization-and-admin-mfa.md), [ADR-0011](adr/0011-web-sessions-bff-cookies.md). Detail: [implementation plan](implementation-plan.md#phase-1-identity-roles-memberships-bilingual-gateway).

### Delivered

- Migration `0002_identity.sql` with 13 tables, the 7 emirates seeded in English and Arabic, an append-only audit log enforced by a trigger, and CHECK constraints for contact, status and permission vocabularies.
- API (31 paths under `/v1`):
  - Customer and business-user auth: register, verify, resend, login, refresh, logout and password reset.
  - Profile and addresses.
  - Memberships with accept and decline.
  - Businesses, mode activation and team management.
  - Admin auth with TOTP, admin invitations, the admin list and the audit log.
  - The emirates reference list.
- Security:
  - Argon2id passwords and HMAC'd one-time codes, with expiry, attempt lockout, resend cooldown and send limits.
  - Redis rate limits that fail closed.
  - Rotating refresh tokens with reuse detection, checked against the session on every request.
  - Default-deny business capabilities; mandatory TOTP for admins, with replay protection and encrypted secrets.
- Customer app: bilingual welcome with Shop Products / Book Services, emirate choice (manual, or suggested from location), a mode switch that persists, sign in/up, verification, password reset and account.
- Business portal: sign in/up, verification, the workspace gateway with mode cards and onboarding state, start a business, team management and invitations.
- Admin console: sign in with TOTP, invite acceptance and authenticator enrolment, admin accounts and the audit log.
- `packages/api-client` (typed client shared by all three apps), a large en/ar message catalog, and fictional seed data (`pnpm db:seed`).
- Screenshots: [`docs/screenshots/phase-1/`](screenshots/phase-1/) (21 screens, English and Arabic RTL, phone and desktop).

### Verified locally (2026-11-27)

| Command                                               | Result                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`                                   | pass                                                            |
| `pnpm lint`                                           | pass, 12 projects                                               |
| `pnpm typecheck`                                      | pass, 12 projects                                               |
| `pnpm test`                                           | pass, 126 unit tests                                            |
| `pnpm build`                                          | pass (packages, API, worker, both Next.js apps)                 |
| `pnpm openapi`, run twice                             | identical output (31 paths); committed with the code            |
| `pnpm db:migrate` on an empty `jays_test`, then again | applied 0001 and 0002, then "database is up to date"            |
| `pnpm test:integration`                               | pass, 54 tests (10 database, 44 API against Postgres and Redis) |
| `pnpm db:seed`, run twice                             | idempotent; refuses `APP_ENV=production`                        |
| `pnpm audit --prod --audit-level high`                | pass (1 moderate: `minimatch` inside Expo build tooling)        |

### Known limitations and follow-ups

- Two simultaneous refreshes with the same token sign the user out (strict reuse detection, ADR-0009). The portals and the app are built to avoid it. A short grace window is the follow-up if the pilot shows it.
- Email and SMS go only to the mock notifier. Choosing real providers and UAE sender-ID registration are founder decisions ([ADR-0007](adr/0007-founder-decisions-and-mvp-defaults.md) D14).
- The terms version is a placeholder (`draft-2026-11`, D13), and the marketing consent wording is a placeholder (D15).
- Arabic copy was written for this phase and needs review by a native speaker before the pilot.
- Platform roles other than superadmin and compliance can sign in but have no capabilities until their features arrive.
- Admin MFA recovery is re-invitation by a superadmin. A documented recovery runbook comes with phase 7.
- The Expo app is exported for web to take screenshots. Native builds (EAS) are not set up yet.

### Rollback

`0002_identity.sql` only adds tables and functions. Runners are forward-only, so rolling back means deploying the previous code and either leaving the new tables unused or dropping them in a new migration. No environment is in production yet, so locally `docker compose down -v` (or dropping the database) resets everything.

## Phase 0: Foundation

Date: 2026-11-27. Branch: `phase-0/scaffold`. Merged in PR #1.

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
