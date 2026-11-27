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

Phase 0 is the foundation only. There are no marketplace features yet.

Requirements: Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```sh
pnpm install            # also builds the shared packages
cp .env.example .env    # fictional local values only
pnpm dev:deps           # PostgreSQL 17 and Redis 7 on 127.0.0.1
pnpm db:migrate         # applies packages/db/migrations
```

| Path                 | What it is                                   | Run                                                                                 | Local URL                       |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| `apps/api`           | NestJS REST API, `/v1`                       | `pnpm --filter @jays/api build && pnpm --filter @jays/api dev`                      | http://localhost:3000/v1/health |
| `apps/worker`        | Background worker                            | `pnpm --filter @jays/worker build && node --env-file=.env apps/worker/dist/main.js` | –                               |
| `apps/business`      | Next.js business portal                      | `pnpm --filter @jays/business dev`                                                  | http://localhost:3001           |
| `apps/admin`         | Next.js admin console                        | `pnpm --filter @jays/admin dev`                                                     | http://localhost:3002           |
| `apps/customer`      | Expo customer app                            | `pnpm --filter @jays/customer start`                                                | Expo Go / simulator             |
| `packages/config`    | Shared tsconfig and the environment schema   |                                                                                     |                                 |
| `packages/domain`    | Money (integer fils), modes, roles, time     |                                                                                     |                                 |
| `packages/contracts` | Error envelope, pagination, health contracts |                                                                                     |                                 |
| `packages/i18n`      | English/Arabic catalogs, RTL helpers         |                                                                                     |                                 |
| `packages/ui`        | Design tokens with contrast tests            |                                                                                     |                                 |
| `packages/db`        | SQL migrations and runner                    |                                                                                     |                                 |

Checks (the same ones CI runs):

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm openapi:check      # apps/api/openapi.json matches the code
DATABASE_URL=postgresql://jays:jays@localhost:5432/jays_test pnpm db:migrate
DATABASE_URL=postgresql://jays:jays@localhost:5432/jays_test REDIS_URL=redis://localhost:6379 pnpm test:integration
```

Integration tests use the separate `jays_test` database, created automatically the first time the Postgres container starts.
