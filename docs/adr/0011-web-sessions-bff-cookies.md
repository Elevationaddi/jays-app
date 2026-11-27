# ADR-0011: Web sessions through server-side cookies (BFF) and CSRF

- Status: Accepted
- Date: 2026-11-27

## Context

The business portal and admin console are Next.js 16 apps that call the API. Keeping tokens in `localStorage` would expose them to any script injection. The customer app is native (Expo) and has the platform's secure storage instead.

## Decision

**Web portals: backend-for-frontend.** The browser never holds an API token in script-readable form.

- Sign-in, registration and every mutation are Server Actions. The Next.js server calls the API server-to-server and stores the access and refresh tokens in `HttpOnly`, `SameSite=Lax` cookies, which are `Secure` in production. The business portal uses `jays_at` and `jays_rt`; the admin console uses `jays_admin_at` and `jays_admin_rt`.
- `src/proxy.ts`, Next 16's replacement for middleware, runs before each page render. When the access cookie has expired and a refresh cookie exists, it rotates the tokens once and passes the new access token to that render. Router prefetches are skipped, so a page with many links does not fire parallel refreshes that would trip reuse detection (ADR-0009). Signed-out visitors to `/business/*` or `/admin/*` are sent to sign in.
- `returnTo` values after sign-in are accepted only if they are same-origin relative paths (`safeReturnTo`), which prevents open redirects.
- The admin console keeps the TOTP enrolment secret in a 10-minute `HttpOnly` cookie scoped to `/invite` between the two enrolment steps. The QR code is rendered on the server.

**CSRF.** State changes happen only through Server Actions. Next.js rejects a Server Action whose `Origin` does not match the host. Combined with `SameSite=Lax` cookies, a cross-site page cannot submit a state change with the user's session. There are no state-changing `GET` routes.

**Customer app.** The refresh token lives in `expo-secure-store` (Keychain / Keystore), and the access token only in memory. On start the app restores the session with one refresh, and forgets the saved token only if the API rejects it (an offline start keeps it). Phase 1 screens make no other authenticated calls. When later phases add them, refresh must be single-flight (one rotation shared by concurrent requests) because of reuse detection (ADR-0009).

**Language.** The language choice lives in a non-sensitive `lang` cookie on the web and in app state on mobile. The `<html dir>` follows it, so Arabic renders right-to-left.

## Consequences

- An XSS bug in a portal cannot read tokens. It could still act as the user while the page is open, so the content-security policy and output encoding still matter (phase 7).
- Every portal page render is server-side and dynamic. That fits authenticated dashboards, and public pages that need caching come later in their own app routes.
- The API stays a plain bearer-token API, so mobile, web and future integrations all use the same endpoints.
