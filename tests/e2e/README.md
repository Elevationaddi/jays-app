# End-to-end tests

`smoke.mjs` drives the business portal, the admin console and the customer web build in a real
browser (Chromium through Playwright). It covers parts of the acceptance tests in
`docs/09-security-testing.md`:

- T03: an owner cannot open another business's workspace; the admin console needs an
  authenticator code.
- T11: Arabic pages are right to left and English left to right; the customer web build opens
  without asking for location.
- T12: a 6 MB business document goes from the browser straight to its signed upload URL and is
  accepted only after the API's checks.
- Security headers on both portals.

## Running

1. Start the local stack with the fictional seed data: `pnpm dev:deps`, `pnpm db:migrate`,
   `pnpm db:seed`, then the API (3000), business portal (3001) and admin console (3002).
2. Optionally build and serve the customer web build: `pnpm --filter @jays/customer export:web`,
   serve `apps/customer/dist`, and set `WEB_URL`.
3. `pnpm test:e2e`

Playwright is used when it is installed on the machine; it is not a repository dependency, so the
script skips itself without it. Adding `@playwright/test` (open source, no cost) to run these in
CI is a follow-up. CI already checks the Vercel mode and the portal headers with the built images.

These are not real-device tests. iOS and Android devices have not been tested.
