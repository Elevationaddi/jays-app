# UAE dual marketplace — developer package

Copy these files into repository root. Start Claude Code in that directory and instruct it to read CLAUDE.md and implement phase 0. This is a specification, not executable application code.

- [01-product.md](docs/01-product.md)
- [02-customer.md](docs/02-customer.md)
- [03-business.md](docs/03-business.md)
- [04-admin.md](docs/04-admin.md)
- [05-workflows.md](docs/05-workflows.md)
- [06-architecture-data.md](docs/06-architecture-data.md)
- [07-api.md](docs/07-api.md)
- [08-design.md](docs/08-design.md)
- [09-security-testing.md](docs/09-security-testing.md)
- [10-build-plan.md](docs/10-build-plan.md)

## Implementation

- [Phased implementation plan](docs/implementation-plan.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Architecture decision records](docs/adr/README.md), including [founder decisions still needing approval](docs/adr/0007-founder-decisions-and-mvp-defaults.md)
- Full combined specification and storyboard: [`reference/`](reference/)

## Local development

Phases 1 and 2 are in place: sign-up and sign-in for customers and business users, business teams with permission-scoped staff, invite-only admins with an authenticator app, the bilingual Shop Products / Book Services gateway, and merchant onboarding. Businesses submit their legal details, documents and a bilingual storefront; compliance admins approve or request changes with a written reason; customers see only approved stores. Products, bookings and payments start in later phases (see [status](docs/IMPLEMENTATION_STATUS.md)).

Requirements: Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```sh
pnpm install            # also builds the shared packages
cp .env.example .env    # fictional local values only
pnpm dev:deps           # PostgreSQL 17 and Redis 7 on 127.0.0.1
pnpm db:migrate         # applies packages/db/migrations
pnpm db:seed            # fictional local accounts and businesses (idempotent, refuses production)
```

### Local accounts after `pnpm db:seed`

Every seeded account uses the password `Local-Dev-Passw0rd!`. All names, emails and phone numbers are fictional.

| Who                                             | Sign in as                                                               | Where           |
| ----------------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| Customer                                        | `customer.en@example.test` (English), `+971500000101` (Arabic, mobile)   | customer app    |
| Shop owner (Noor Beauty Supply)                 | `owner.noor@example.test`                                                | business portal |
| Services owner (Lumière Salon)                  | `owner.lumiere@example.test`                                             | business portal |
| Hybrid owner (Oud & Bloom), with staff          | `owner.oud@example.test`                                                 | business portal |
| Shop owner waiting for review (Saffron)         | `owner.saffron@example.test`                                             | business portal |
| Draft business to try the forms (Amber Atelier) | `customer.both@example.test`                                             | business portal |
| One admin per platform role                     | `<role>@admin.example.test`, for example `superadmin@admin.example.test` | admin console   |

Admins also need an authenticator code. For seeded admins, print the current one with `pnpm --filter @jays/api totp superadmin@admin.example.test`.

Noor, Lumière and Oud & Bloom are approved and public. Saffron Skin Co. waits in the admin review queue (sign in as `compliance@admin.example.test` to decide). Amber Atelier is an empty draft.

Noor and Oud & Bloom sell 5 live fictional products, some with low or no stock, and deliver to Dubai, Abu Dhabi and (Noor) Sharjah. Noor also has one product waiting in the listing queue (sign in as `catalog@admin.example.test`) and one draft. `customer.en` has a saved Dubai address, so you can go from the shop to a paid order in the app.

Payments use the mock provider ([ADR-0013](docs/adr/0013-catalog-inventory-checkout-and-mock-payments.md)). The app's checkout shows a test payment page; the result reaches the API as a signed webhook at `API_PUBLIC_URL/webhooks/payments`, so the API must be able to reach its own public URL. With `MOCK_PAYMENT_OUTCOMES=true` the page can also simulate a declined payment. Run the worker to expire unpaid orders and release held stock. Production refuses `PSP_PROVIDER=mock`.

Uploaded files are stored on disk under `STORAGE_LOCAL_DIR` (default `.local-storage`, relative to the API's working directory) and served through signed links at `API_PUBLIC_URL`. The mock malware scanner refuses files containing the EICAR test string. Production refuses to start with `STORAGE_PROVIDER=local` or `MALWARE_SCANNER=mock` ([ADR-0012](docs/adr/0012-merchant-onboarding-storage-and-review.md)).

Verification codes are not sent anywhere locally. The mock notifier writes them to the API log (lines starting `[mock email]` or `[mock sms]`, with the code in the JSON).

To create the first real superadmin on an empty database, run `pnpm --filter @jays/api admin:bootstrap -- ops@company.example "Display Name"`. It prints a one-time invitation link, and it refuses to run once a superadmin exists.

| Path                  | What it is                                                             | Run                                                                                 | Local URL                       |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| `apps/api`            | NestJS REST API, `/v1`                                                 | `pnpm --filter @jays/api build && pnpm --filter @jays/api dev`                      | http://localhost:3000/v1/health |
| `apps/worker`         | Background worker                                                      | `pnpm --filter @jays/worker build && node --env-file=.env apps/worker/dist/main.js` | –                               |
| `apps/business`       | Next.js business portal                                                | `pnpm --filter @jays/business dev`                                                  | http://localhost:3001           |
| `apps/admin`          | Next.js admin console                                                  | `pnpm --filter @jays/admin dev`                                                     | http://localhost:3002           |
| `apps/customer`       | Expo customer app                                                      | `pnpm --filter @jays/customer start` (`w` for web)                                  | Expo Go / simulator / web       |
| `packages/config`     | Shared tsconfig and the environment schema                             |                                                                                     |                                 |
| `packages/domain`     | Money (integer fils), modes, roles, permissions and capabilities, time |                                                                                     |                                 |
| `packages/contracts`  | Zod request/response schemas (validation and OpenAPI)                  |                                                                                     |                                 |
| `packages/api-client` | Typed API client shared by the three apps                              |                                                                                     |                                 |
| `packages/i18n`       | English/Arabic catalogs, RTL helpers                                   |                                                                                     |                                 |
| `packages/ui`         | Design tokens with contrast tests                                      |                                                                                     |                                 |
| `packages/db`         | SQL migrations, runner and Kysely table types                          |                                                                                     |                                 |

Checks (the same ones CI runs):

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm openapi:check      # apps/api/openapi.json matches the code
DATABASE_URL=postgresql://jays:jays@localhost:5432/jays_test pnpm db:migrate
DATABASE_URL=postgresql://jays:jays@localhost:5432/jays_test REDIS_URL=redis://localhost:6379 pnpm test:integration
```

Integration tests use the separate `jays_test` database, created automatically the first time the Postgres container starts.

## Screenshots

Screens in English and Arabic (RTL) are in [`docs/screenshots/phase-1/`](docs/screenshots/phase-1/), [`docs/screenshots/phase-2/`](docs/screenshots/phase-2/) and [`docs/screenshots/phase-3/`](docs/screenshots/phase-3/). Arabic copy still needs review by a native speaker.

| Customer app (phase 3)                                                                | Business portal (phase 3)                                                          | Admin console (phase 3)                                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| <img src="docs/screenshots/phase-3/customer-14-checkout-review-en.png" width="220" /> | <img src="docs/screenshots/phase-3/business-16-product-edit-en.png" width="360" /> | <img src="docs/screenshots/phase-3/admin-11-listing-review-en.png" width="360" /> |

| Customer app (phase 2)                                                            | Business portal (phase 2)                                                                | Admin console (phase 2)                                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/phase-2/customer-10-shop-stores-en.png" width="220" /> | <img src="docs/screenshots/phase-2/business-09-verification-draft-en.png" width="360" /> | <img src="docs/screenshots/phase-2/admin-06-business-review-in-progress.png" width="360" /> |

| Customer app                                                                      | Business portal                                                                          | Admin console                                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| <img src="docs/screenshots/phase-1/customer-02-welcome-ar-rtl.png" width="220" /> | <img src="docs/screenshots/phase-1/business-03-gateway-hybrid-ar-rtl.png" width="360" /> | <img src="docs/screenshots/phase-1/admin-03-security-and-audit.png" width="360" /> |
