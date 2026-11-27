# ADR-0002: Monorepo and toolchain

- Status: Accepted
- Date: 2026-11-27

## Context

`docs/10-build-plan.md` proposes one repository with `apps/customer`, `apps/business`, `apps/admin`, `apps/api`, `apps/worker` and `packages/domain`, `db`, `ui`, `i18n`, `contracts`, `config`. These share types, validation rules and money logic, which must not drift between clients and server.

## Decision

- **pnpm workspaces** (pnpm 10.28, pinned via `packageManager`). No extra task runner yet; `pnpm -r` runs scripts in dependency order. Turborepo or Nx can be added later if build times demand it.
- **Node.js 22 LTS** (`.nvmrc`, `engines >=22.13`).
- **TypeScript 6.0, strict** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (relaxed only in the NestJS app, where decorator DTOs need it). TypeScript 7 (native compiler) is out, but `typescript-eslint` 8.74 supports TypeScript up to 6.0, so we stay on 6.0 until the lint tooling catches up.
- **ESM everywhere** except the Expo app, which follows Expo's own module setup.
- Shared packages compile to `dist/` with `tsc`; `postinstall` builds them so apps always consume built output.
- **ESLint 10** flat config at the root with `typescript-eslint`, **Prettier 3**, **Vitest 5** for unit and integration tests.
- Install scripts are blocked except for allow-listed packages (`onlyBuiltDependencies`), which limits supply-chain exposure.
- Dependency versions use caret ranges recorded in `pnpm-lock.yaml`; CI installs with `--frozen-lockfile`.

## Consequences

- One `pnpm install` sets up everything; CI runs the same root scripts as developers.
- Adding a package means adding a `package.json`, `tsconfig.json`, `tsconfig.build.json` and tests; the root scripts pick it up automatically.
