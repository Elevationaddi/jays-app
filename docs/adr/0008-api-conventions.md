# ADR-0008: API conventions: errors, request IDs, OpenAPI

- Status: Accepted
- Date: 2026-11-27

## Decision

- All routes live under **`/v1`**. Nothing is served outside it.
- Every response carries an **`x-request-id`** header. A caller-supplied id is reused only if it matches `^[A-Za-z0-9._-]{8,128}$`; otherwise a UUID is generated. The id is on every log line.
- Every error uses the envelope from `docs/07-api.md`: `{ "error": { "code", "message", "fieldErrors?", "requestId" } }`. Unexpected errors return a generic 500 and are logged with their stack; internals never reach clients. Specific codes (for example `SLOT_UNAVAILABLE`) are thrown with `ApiError`.
- Logs are structured JSON (pino). Authorization headers, cookies, idempotency keys, passwords, OTPs, tokens, secrets and card fields are redacted.
- `helmet` security headers; CORS allows only `CORS_ORIGINS`.
- Health: `GET /v1/health` (liveness, no dependencies) and `GET /v1/health/ready` (PostgreSQL and Redis; 503 when either is down; a dependency with no probe counts as down).
- **OpenAPI 3.1** is generated from the implemented controllers and DTOs (`pnpm openapi` writes `apps/api/openapi.json`). CI regenerates it and fails if the committed file differs, so the document cannot drift from the code.
- Request validation: from phase 1, request bodies are validated with the Zod schemas in `packages/contracts`, shared with clients, and validation failures map to `400 VALIDATION_FAILED` with `fieldErrors`.

## Consequences

- Clients can rely on one error shape and quote the request id to support.
- Each phase's PR includes the regenerated `openapi.json`.
