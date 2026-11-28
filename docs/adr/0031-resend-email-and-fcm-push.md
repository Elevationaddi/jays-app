# ADR-0031: Resend email, Firebase push and the email budget

Status: Accepted (technical design). No real-provider result is claimed: the adapters are tested against fakes, and the real-provider tests need credentials the founder has not set up yet.

Date: 2026-11-28

## Context

ADR-0024 chose Resend Free for email and Firebase Cloud Messaging (Spark) for push, with no SMS. Before this change:

- notifications went only through a mock;
- the transactional push and email preferences existed (ADR-0019), but nothing sent push;
- sign-up and password recovery could use a phone number, which needs SMS.

Resend Free allows 100 emails a day and 3,000 a month, and refuses mail over the limit.

## Decision

1. **Resend adapter.**
   - `ResendNotifier` posts to Resend's REST API with `fetch`, so no SDK is added.
   - Notification emails carry an idempotency key per event, person and channel, so a retried event is not emailed twice.
   - Errors never contain the key or the address.
2. **Bilingual templates.**
   - Each email has inline-styled HTML and a text part, in English and Arabic. The Arabic version is right to left.
   - The brand name comes from the central brand setting (D1).
   - Every value is escaped.
   - Only https links are rendered (and http on localhost for development), and links are shown in full.
   - Expiry times come from the same constants the API enforces.
3. **Email budget.**
   - A table counts essential and other email per UTC day.
   - A slot is reserved before each send, under a transaction lock, and given back if Resend refuses the message. Concurrent senders therefore cannot go over the limit.
   - Non-essential email stops at 80% of the daily or monthly allowance. The rest is kept for essential email: sign-in codes, password reset, the "account exists" notice and admin invitations. Essential email can still go over the 80% mark.
   - When the allowance is used up, the notification event is not failed. The outbox keeps it for the next window, after 00:05 UTC the next day or month. What was already delivered (in-app notifications, push, earlier emails) is not sent again.
   - The limits are `EMAIL_DAILY_LIMIT` and `EMAIL_MONTHLY_LIMIT`, with defaults of 100 and 3,000.
4. **No SMS.**
   - Notifiers declare which channels they support.
   - With Resend there are no text messages, so sign-up, verification and password recovery by phone return `422 SMS_UNAVAILABLE`.
   - The check depends only on whether the identifier is a phone number, never on whether an account exists. It cannot be used to find out which accounts exist.
5. **Push.**
   - Devices register FCM tokens with `POST /v1/me/push-devices`, and stop with `POST /v1/me/push-devices/unregister`.
   - A token belongs to the last account that registered it. A person can have at most 10 active devices; registering more revokes the oldest.
   - Tokens are never returned by the API. Deleting an account removes its tokens.
   - The dispatcher pushes each event once per person, to every active device, when that person's push preference is on. It does this before email, so a full email allowance never holds push back.
   - Tokens FCM reports as unregistered are revoked.
   - If FCM is down, the event is retried. Devices that already received the push may get it twice; push carries no money or security action.
6. **FCM adapter.**
   - `FcmPushSender` uses the HTTP v1 API.
   - It signs its own OAuth assertion with the service account's key (RS256 with `node:crypto`), so no Google SDK is added.
   - It caches the access token and gets a new one once after a 401.
7. **Configuration.**
   - `NOTIFY_PROVIDER` is `mock` or `resend`. `resend` needs `EMAIL_KEY` and `EMAIL_FROM`.
   - `PUSH_PROVIDER` is `none`, `mock` or `fcm`. `fcm` needs a valid `FCM_SERVICE_ACCOUNT_JSON`.
   - Production refuses the mock email and push providers.
8. **Tests are labelled.**
   - Mock tests: unit tests in `notify.test.ts`, and integration tests in `notify.int.test.ts` covering devices, push dispatch, the budget against the database (including concurrency) and the SMS refusal.
   - Real-provider tests in `notify.provider.test.ts` run with `pnpm --filter @jays/api test:providers` and credentials. They have not been run.

## Not done yet

- **Registering devices in the apps.** The customer app needs `expo-notifications` with the Firebase files from the setup guide, and a development build. Web push needs a VAPID key. Both need the Firebase project first.
- **Resend delivery webhooks** for bounces and complaints. Resend's dashboard shows them in the meantime.
- **The usage card** with today's and this month's email counts. It is built in phase 10; `EmailBudget.usage()` already provides the numbers.

## Consequences

- No paid service is added. Resend Free and Firebase Spark cost nothing within their limits. The budget keeps JAYS inside Resend's limits.
- Founder actions: verify a sending domain at Resend, create the Firebase project, and set the variables in Vercel (docs/FOUNDER_SETUP_GUIDE.md sections 3 and 5).
- Migration 0018 adds `email_usage` and `push_devices`, and the push delivery channel.
