# ADR-0009: Identity, verification and sessions

- Status: Accepted (engineering decision). The terms version and contact-channel choices it depends on stay in [ADR-0007](0007-founder-decisions-and-mvp-defaults.md).
- Date: 2026-11-27

## Context

Phase 1 adds customer and business-user sign-in (`docs/02-customer.md`, `docs/03-business.md`, `docs/09-security-testing.md`). Customers and business staff share one account type: a person can shop, book and work for a business with the same login. Admins are a separate population (ADR-0010).

## Decision

**Accounts.** One `users` table. A user registers with an email address or a UAE mobile number (E.164, `+9715XXXXXXXX`) and a password. The account stays `pending_verification` until that contact is verified, and an unverified account cannot reach any business route. The accepted terms version and time are stored on the account. The version is the placeholder `draft-2026-11` until the founder approves the terms.

**Passwords.** Argon2id (`@node-rs/argon2`, m = 19 MiB, t = 2, p = 1, the OWASP baseline). The minimum is 10 characters with letters and a digit, and the maximum is 128. A login for an unknown account still verifies a dummy hash, so response time does not reveal whether an account exists.

**One-time codes.** Codes have 6 digits from a CSPRNG. They are stored as an HMAC-SHA256 keyed by `OTP_SECRET` and bound to the challenge id, so a leaked table cannot be brute-forced offline and a code cannot be replayed against another challenge. Each code:

- expires after 10 minutes and is single-use;
- allows 5 wrong attempts before the challenge is burnt;
- has a 60-second resend cooldown and at most 5 sends per challenge.

Password-reset and resend requests for an unknown contact create a decoy challenge with no user, so the response is the same either way (no account enumeration). Signing in to an unverified account answers `verification_required` with a fresh challenge instead of tokens.

**Rate limits.** Fixed-window counters in Redis, keyed by client IP and by a SHA-256 of the normalized contact (never the raw contact). Over the limit, the API answers `429 RATE_LIMITED` with `Retry-After`. If Redis is unavailable, auth endpoints answer `503` (fail closed) rather than allowing unlimited guessing. The limits are in `apps/api/src/auth/policy.ts`. Client IPs come from `X-Forwarded-For` only up to `TRUST_PROXY_HOPS` hops.

**Tokens.**

- _Access token:_ a JWT (HS256) lasting 15 minutes, with audience `user` and claims `sub` and `sid`. It is signed with the first key of `JWT_KEYS` (`kid:secret,…`); the other keys are still accepted, so keys can be rotated without logging everyone out.
- _Refresh token:_ opaque, `<sessionId>.<random 256 bits>`; only its SHA-256 is stored. It expires after 30 days idle and 90 days absolute.
- _Rotation:_ every refresh rotates the secret under `SELECT … FOR UPDATE`. Presenting a refresh token that was already rotated is treated as theft: the whole session is revoked (`refresh_reuse`), and the legitimate holder must sign in again.
- _Checked on every request:_ the session behind an access token must still be live, so logout, reuse detection and password reset take effect at once, not after 15 minutes.
- _Password reset:_ revokes every session of the user.

**Notifications.** Codes are sent through a `Notifier` port. Locally and in CI the only adapter is `MockNotifier` (`NOTIFY_PROVIDER=mock`), which logs a masked destination with the code and keeps recent messages for tests. The environment schema refuses `mock` in production, so a real email/SMS provider must be chosen before launch. Choosing that provider is a founder/vendor decision.

**Audit.** Registration, verification, login, logout, password reset, reuse detection, consent changes and every membership or admin change write to `audit_logs`. The table is append-only, enforced by a trigger, and its diffs are redacted.

## Consequences

- No account enumeration through register, login, reset or resend responses or their timing.
- A stolen refresh token is usable at most once before the session dies.
- **Known limitation:** two requests that refresh the same token at the same moment trip reuse detection and sign the user out. The web portals avoid this by refreshing in one place (the request proxy, skipping prefetches), and the customer app refreshes only once, at start. If it shows up in the pilot, a short grace window for the immediately previous token is the follow-up.
- Every authenticated request reads its session row. That is an indexed primary-key lookup, and it is the price of instant revocation.
