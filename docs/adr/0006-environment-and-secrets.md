# ADR-0006: Environment configuration, secrets and mock providers

- Status: Accepted
- Date: 2026-11-27

## Context

The build plan lists `DATABASE_URL`, `REDIS_URL`, `JWT_KEYS`, `STORAGE_BUCKET`, `PSP_API_KEY`, `PSP_WEBHOOK_SECRET`, `MAPS_KEY`, `EMAIL_KEY`, requires that no secrets are committed and that dev-only switches are prohibited in production. Payment outcomes must be testable locally (success, fail, timeout, duplicate) without faking real payment confirmation.

## Decision

- One **Zod schema per process** in `packages/config` (`apiEnvSchema`, `workerEnvSchema`, `databaseEnvSchema`). Processes validate at start and exit on failure. Error messages name the variable and the rule but never echo the value.
- `APP_ENV` is one of `local`, `test`, `staging`, `production`. When it is `production` the schema refuses:
  - the `mock` payment provider (only mock exists until phase 5, so production cannot start until a real provider is integrated, which is intentional),
  - `MOCK_PAYMENT_OUTCOMES=true` and any other dev switch,
  - any value containing the `local-dev-only` marker carried by every committed example,
  - missing `MAPS_KEY` / `EMAIL_KEY`,
  - non-HTTPS CORS origins.
- `.env.example` documents every variable with fictional local values. `.env` files are git-ignored; CI runs gitleaks on full history.
- Local development uses **mock adapters** that behave like real providers: the mock PSP will emit signed, possibly delayed or duplicated webhooks, and orders/bookings only become paid through the same verified-webhook path as production. A mock never short-circuits confirmation.
- Staging and production secrets live in the hosting platform's secret manager (chosen in phase 7), never in the repository.

## Consequences

- A misconfigured deploy fails fast at boot instead of failing on the first request.
- The `JWT_KEYS` format is fixed in phase 1 (planned: a JSON set of signing keys with key IDs, to allow rotation); until then the schema only enforces a minimum length.
