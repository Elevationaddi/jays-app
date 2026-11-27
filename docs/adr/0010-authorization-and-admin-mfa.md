# ADR-0010: Authorization model and admin MFA

- Status: Accepted (engineering decision). The capabilities given to each platform role beyond the two below are defined phase by phase as admin features arrive.
- Date: 2026-11-27

## Context

`docs/01-product.md` defines three top-level roles: customer, business and admin. `docs/03-business.md` adds permission-scoped staff inside a business. `docs/09-security-testing.md` requires default deny, tenant isolation and MFA for admins (T03).

## Decision

**Customers and business users are the same accounts.** Business access is never a flag on the user or a claim in the token. It is a row in `memberships(business_id, user_id, permissions[], status)`, read from the database on every business request.

**Business permissions → capabilities, default deny.** The permissions are `owner`, `manager`, `fulfillment`, `scheduler`, `finance` and `professional`. Each one grants a fixed set of capabilities (`packages/domain/src/access.ts`, `BUSINESS_GRANTS`). A capability that no permission grants is refused, and unknown permission strings grant nothing. A `CHECK` constraint keeps the column to the known vocabulary. Routes declare the capability they need with `@RequireBusinessCapability(...)`, and `BusinessAccessGuard` enforces it:

- not authenticated → `401`;
- not an active member of that business → `404` (does not reveal that the business exists);
- a member without the capability → `403 FORBIDDEN`.

**Who can grant what.** Owners can grant anything. Managers can invite and change only `fulfillment`, `scheduler` and `professional`. `owner`, `manager` and `finance` are owner-only, because they control people and money. The last active owner cannot be removed or demoted; the check runs under a row lock, so two concurrent demotions cannot both succeed. Members cannot change their own permissions. Invitations go to an existing verified account and stay `invited` until the invitee accepts. Accepting is always the invitee's own action, never something a business does to them. Each change is audited and emits an outbox event (`business.member_invited`) for later notification delivery.

**Business modes.** `business_modes` holds one row per activated mode (`shop`, `services`), with an onboarding status. A mode that has not been activated reports `not_activated` and is not a row. Activating a mode needs `modes.manage` (owner only). Approval happens in phase 2.

**Admins are separate.** Admin accounts live in `admin_accounts` with their own sessions table, their own token audience (`admin`, 10-minute access tokens, 8-hour idle and 24-hour absolute refresh) and their own console. A user token is never accepted on an admin route, and an admin token is never accepted on a user route. Admins are invite-only: there is no self-registration. The first superadmin is created with `pnpm --filter @jays/api admin:bootstrap`, which only works while no superadmin exists.

**Platform roles.** The roles are `superadmin`, `compliance`, `catalog`, `operations`, `finance`, `support` and `analyst` (`docs/04-admin.md`). Phase 1 defines two capabilities:

- `admins.manage`: superadmin only.
- `audit.view`: superadmin and compliance.

Every other role can sign in but sees no data until later phases give it capabilities. Inviting an admin requires a written reason, which goes into the audit log.

**Admin MFA is mandatory.** An invite link sets a password and then enrols a TOTP authenticator (RFC 6238, SHA-1, 6 digits, 30-second step, ±1 step). The account becomes `active` only after the first valid code. Every admin login then needs email, password and a current code. Replay is blocked by storing the last accepted step (`mfa_last_step`) and refusing any step at or before it. TOTP secrets are encrypted at rest with AES-256-GCM, using a key derived (HKDF-SHA256) from `MFA_ENCRYPTION_KEY`. Failed admin logins return one generic error, whether the password or the code was wrong.

## Consequences

- Tenant isolation does not depend on client input: changing a business id in a URL only finds businesses where the caller has a membership.
- New features add a capability and the permissions that grant it in one place, and the guard and the portal UI (`myCapabilities`) follow.
- Admin MFA recovery (lost device) is deliberately not self-service. Another superadmin re-invites the admin. A documented recovery procedure is part of phase 7 hardening.
