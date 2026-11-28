# ADR-0019: Account privacy, marketing consent and account deletion

Status: Accepted (technical design). The consent wording, the grace period and the retention list are **proposed** and need legal approval (ADR-0018 D13, D15). Nothing here marks a legal document as approved.

Date: 2026-11-28

## Context

Before this change, marketing consent was a single flag on the user (`users.marketing_consent`). D15 asks for consent that is optional, granular and separate from the terms. It must record the source, time, language, policy version and withdrawal history, with preferences and an unsubscribe. D14 keeps marketing apart from transactional messages. Phase 11 needs account deletion for the app stores.

## Decision

1. **Marketing consent is per channel: email, SMS and push.**
   - The current choice is kept on `users` (`marketing_email`, `marketing_sms`, `marketing_push`) for fast checks.
   - Every real change also writes a row to `consent_records`. Each row holds the purpose, granted or withdrawn, the source, the language the wording was shown in, the policy version and the request id.
   - The table is append-only, enforced by a trigger, so withdrawals can never be lost.
   - Sources are `signup`, `settings`, `unsubscribe_link`, `account_deletion` and `migration`.
   - Repeating the current choice writes nothing.
   - Migration 0008 carries over each existing "yes" as consent on all three channels. These rows have source `migration`, the user's terms version and the original time. It then drops the old flag.
2. **Sign-up asks for each channel separately**, after the mandatory terms box and never pre-ticked (`register.marketing`). Consent changed on `PATCH /me` before; that field is removed in favour of `PATCH /me/privacy`, which takes the language the wording was shown in.
3. **Transactional preferences** (`notify_email`, `notify_sms`, `notify_push`) control order, booking and return updates outside the app.
   - The notification dispatcher only emails a verified address whose owner has email switched on.
   - In-app notifications always arrive.
   - Security messages (verification codes, password resets) always send, because the account depends on them.
4. **One-click unsubscribe** uses `GET` (preview) and `POST` (withdraw) on `/v1/unsubscribe?token=`.
   - The token is `base64url(userId:channel).HMAC`. The key is derived from `OTP_SECRET` under its own label, so no new secret is needed and the raw key is never shared between uses.
   - Tokens never expire, because a link in an old email must keep working.
   - A token can only withdraw consent, never grant it. Requests are rate limited per IP.
   - The customer app opens `…/unsubscribe?token=…` links without sign-in.
   - The sender that puts these links into marketing messages arrives with the email provider in phase 9.
5. **Data export:** `GET /me/export` returns the person's profile, privacy settings, consent history, addresses, orders, appointments, reviews and support requests as JSON.
6. **Account deletion:**
   - `POST /me/deletion` needs the current password and is rate limited per user.
   - It is refused (`ACCOUNT_HAS_OPEN_ACTIVITY`) while the person has an active business membership, an order not yet delivered, an upcoming appointment or an open return. Those need the person reachable.
   - The account is anonymised after a **14-day grace period** (proposed). `DELETE /me/deletion` cancels it.
   - The worker's hourly job calls `complete_account_deletions`, a database function the API also uses in tests. If something became active during the grace period, it postpones the deletion by a day and records why.
   - Anonymisation does the following:
     - Replaces the email with `deleted-<id>@deleted.invalid` and clears the phone, name, emirate and preferences.
     - Sets an unusable password hash and deactivates the account.
     - Scrubs and archives addresses.
     - Deletes verification challenges and revokes sessions.
     - Removes pending invitations.
     - Records consent withdrawals and an audit entry.
   - The email address can then be used for a new account.
7. **What is kept after deletion (proposed, for legal review):** orders and their address snapshots, payments, refunds, ledger entries, invoices, payouts, reviews and support tickets. They stay for tax, accounting, dispute and fraud reasons, attached to the anonymised account. Reviews then show no name.

## Consequences

- `Me.marketingConsent` is replaced by `Me.marketing { email, sms, push }`. The customer app, the business portal sign-up and the API client are updated in the same change.
- Push consent and push preferences are stored now. Push delivery arrives with Firebase Cloud Messaging in phase 9.
- Open for legal: the consent wording (`MARKETING_POLICY_VERSION = draft-2026-11`), the 14-day grace period, the retention list above, and whether reviews should be removed rather than anonymised.
