# ADR-0035: Private staging environment

Status: Accepted (technical design and code). **Not deployed yet.** The founder approved a private staging environment on the existing Vercel account on 28 November 2026 (question 1), subject to confirming the plan, available usage and spending controls. Those confirmations are listed in [STAGING.md](../STAGING.md), step 0, and the first deployment waits for them.

Date: 2026-11-28

## Context

The founder's rules for staging (question 1):

- Fictional data only. No real customer personal information.
- No real customer payments: Stripe test mode only.
- No real merchant verification documents.
- Not indexed by search engines.
- No unrestricted public registration.
- No production credentials.
- Authenticated access, using what the approved infrastructure already offers.

ADR-0033 planned staging as each Vercel project's **Preview** environment. Two Vercel facts change that:

1. **Vercel Cron only runs on Production deployments.** On Preview, the minute, five-minute and hourly jobs would never run, so notifications, hold expiry, reminders and reconciliation could not be tested.
2. **Vercel Authentication** (part of Standard Deployment Protection, included on every plan) protects every `*.vercel.app` address, including a project's production `vercel.app` address. It does not protect a custom domain. **Password Protection** is a paid add-on and is not used.

Browser requests from the customer web app to the API are cross-site. They cannot carry the Vercel Authentication cookie of another project, and Stripe webhooks cannot sign in to Vercel. So the API cannot sit behind Vercel Authentication. It needs its own gate.

## Decision

### 1. A separate set of staging projects

Staging is its own set of four Vercel projects, whose **Production** environment is staging. Production later gets a separate set, with the founder's approval.

| Staging project         | Root directory  | Vercel Authentication          |
| ----------------------- | --------------- | ------------------------------ |
| `jays-staging-api`      | `apps/api`      | Off (the API gates itself, §2) |
| `jays-staging-business` | `apps/business` | On (Standard Protection)       |
| `jays-staging-admin`    | `apps/admin`    | On (Standard Protection)       |
| `jays-staging-web`      | `apps/customer` | On (Standard Protection)       |

- Each project deploys `main` to its staging "production" environment, so cron jobs run, and each merge updates staging.
- No custom domain is added to staging. Standard Protection covers every `vercel.app` address only while no custom domain is used.
- Only members of the founder's Vercel team can open the business portal, the admin console or the customer web app. Adding a team member can cost a seat, so testers are added only with the founder's approval.
- These projects use their own Supabase project, Resend key, Stripe **test** keys and Firebase project. They never share a credential with production.

### 2. The API's own gate: `STAGING_ACCESS_TOKEN`

When `STAGING_ACCESS_TOKEN` is set (configuration requires it when `APP_ENV=staging`):

- Every request must carry `x-staging-access: <token>`, compared in constant time. A request without it gets `401 STAGING_ACCESS_REQUIRED`, before any route or database query runs.
- Some paths stay open, each because it has its own protection or is opened by something that cannot add a header:
  - `/v1/health` carries no data;
  - `/v1/webhooks/*` is verified by the Stripe signature;
  - `/v1/internal/cron/*` needs `CRON_SECRET`;
  - `/v1/metrics` needs `METRICS_TOKEN`;
  - `/v1/storage/objects/*` links are HMAC-signed and short-lived;
  - `/v1/unsubscribe` takes a signed one-time token;
  - `/v1/mock-psp/*` is the mock payment page, which only exists with the mock provider.
- Every response carries `X-Robots-Tag: noindex, nofollow`, and `/robots.txt` disallows everything.
- The business portal and the admin console send the header **from their servers**. The token is a server variable there and never reaches a browser.
- The customer web build and staging mobile builds carry it as `EXPO_PUBLIC_STAGING_ACCESS_TOKEN`. That is visible to anyone who can load the app. On the web, only Vercel team members can load it (§1). A staging mobile build is shared only with invited testers. The token is therefore a second layer, not the only one, and it is rotated by changing the variable in the three projects.

### 3. Invite-only registration

- `SIGNUP_MODE=allowlist` is required in staging. Only emails in `SIGNUP_ALLOWLIST` can register: exact addresses, or `@domain` entries.
- Everyone else gets `403 SIGNUP_RESTRICTED`. Phone sign-up is already refused because there is no SMS (ADR-0024).
- This does not reveal whether an account exists: the answer depends only on the list.

### 4. No real merchant documents

- `DOCUMENT_UPLOADS=disabled` is required in staging. Starting a verification document upload returns `403 DOCUMENT_UPLOADS_DISABLED`, with a message not to upload real documents.
- The demonstration dataset brings fictional documents (marked "FICTIONAL") for businesses in every review state.
- Product and storefront images still upload, because testers use fictional pictures. They go through the image checks of ADR-0032, and the re-encoding of ADR-0036 once it is merged.
- The malware scanner on staging is the mock (ADR-0032). The mock is clearly a test mechanism. It refuses only the EICAR test file, and production refuses it.

### 5. Noindex everywhere in staging

- **API:** `X-Robots-Tag` header and `/robots.txt`, as in §2.
- **Business portal and admin console:** `X-Robots-Tag: noindex, nofollow`, a `robots` meta tag and a disallow-all `robots.txt` in **every** environment, because private portals should never be indexed.
- **Customer web:** when built with `EXPO_PUBLIC_APP_ENV=staging`, the build writes a disallow-all `robots.txt` and adds a `noindex` meta tag. Production builds stay indexable.

### 6. A visible demonstration-data notice

With `APP_ENV=staging` (portals) or `EXPO_PUBLIC_APP_ENV=staging` (customer app), every page shows a bilingual notice. It says that every business, person, order, booking, review and payment is fictional demonstration data, and that payments are test mode only. Production never shows it.

### 7. Live payments stay impossible

Configuration already refuses live Stripe keys in every environment (ADR-0030). Staging uses `PSP_PROVIDER=stripe` with test keys, or `mock` until those keys exist.

### 8. Spending controls

- The staging projects add no subscription. Their usage counts against the existing Vercel plan's included usage.
- Spend Management must be on, with a low amount and "pause production deployments" ticked (setup guide, step 1), before the first deployment.
- Supabase, Resend and Firebase stay on their free plans, with no card on file.
- The admin usage card (ADR-0033) shows database, storage and email use against the free limits.

## Consequences

- Cron, webhooks and every job can be tested on staging exactly as they will run in production.
- The production project set stays empty until the founder approves it, so a staging mistake cannot reach production variables.
- Testers who are not members of the Vercel team cannot open the portals or the web app. Adding one needs a seat (founder approval), or a staging mobile build.
- New businesses cannot complete onboarding on staging, because their documents cannot be uploaded. Onboarding is tested with the demo businesses, which cover every review state, and locally with the mock scanner.

## Not verified, and why

Nothing has been deployed, so none of this has run on Vercel. Unit tests cover the gate, the open paths, invite-only registration and the configuration rules. The CI container job checks the gate, the noindex header and `robots.txt` against a built API image. These still need checking on the first staging deployment: that Vercel Cron reaches the unprotected API, that Standard Protection covers the projects' `vercel.app` addresses, and that the raw Stripe webhook body arrives intact (ADR-0033).
