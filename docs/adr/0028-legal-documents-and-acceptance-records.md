# ADR-0028: Legal documents, versions and acceptance records

Status: Accepted (technical design). **Every document text is a draft.** No UAE lawyer has been appointed or has reviewed any document (D13). Nothing in this ADR records, implies or allows a claim of legal approval.

Date: 2026-11-28

## Context

D13 asks for draft legal documents, versioning and customer acceptance records. The founder's revised decisions (28 November 2026) list twelve documents, require a separate legal review checklist covering all seven emirates, and say: "Do not mark legal documents as approved or publish them as final without authorization."

Before this change the sign-up form had a single "I accept the terms" checkbox with no stored text, and merchant onboarding stored a fixed agreement label (`merchant-draft-2026-11`) on the business.

## Decision

1. **Twelve document kinds.** `customer_terms`, `merchant_agreement`, `privacy_policy`, `returns_refunds`, `appointment_cancellation`, `home_services`, `marketing_consent`, `prohibited_items`, `review_moderation`, `merchant_licensing`, `authenticity`, `promotional_pricing`. Draft texts in English and Arabic are in `docs/legal/drafts/<kind>.<en|ar>.md`. Each starts with a draft banner, and every fact JAYS has not confirmed (legal entity, licence, address, periods the lawyer must set) is a `[●]` placeholder. No licensing requirement or legal rule has been invented: where a rule depends on law or an authority, the text says it is to be confirmed.
2. **Versions.** `legal_documents` holds numbered versions per kind with a localized title and body (Markdown, up to 60,000 characters per language), a summary of changes, and a status:
   - `draft`: editable, visible only to admins with `legal.manage` (granted to compliance and the superadmin);
   - `published`: shown to people and can be accepted. At most one per kind (unique partial index). Publishing retires the previous version in the same transaction;
   - `retired`: kept for the record.
   - A database trigger freezes the text, kind, version and dates of a published or retired version and refuses to delete it. A change is a new version.
3. **No approval column.** There is deliberately no field that marks a document as legally approved. The API returns `legalReview: "pending"` on every document, and the customer app, business portal and admin portal show a draft notice beside every document. Recording a lawyer's sign-off is a later change, made when a lawyer is appointed and the founder authorizes it.
4. **Production safety gate.** `LEGAL_REVIEW_COMPLETE = false` is a code constant in `@jays/domain`, like `TAX_RULES_APPROVED`. While it is false, publishing returns `409 LEGAL_REVIEW_REQUIRED` when `APP_ENV=production`. Drafts can be published in local and staging environments so the flows can be tested. Changing the constant is a founder decision recorded in an ADR, not a setting.
5. **Acceptance records.** `legal_acceptances` is append-only (trigger). Each row records the user, the exact document version (id, kind and version), the business for a merchant agreement, the locale shown, the source (`sign_up`, `reaccept`, `merchant_onboarding`), the request id and the time. A trigger allows only the published version of the named kind and version. A user accepts a version once (per business for the merchant agreement).
6. **Who accepts what.**
   - Sign-up records acceptance of the published `customer_terms` and `privacy_policy` in the sign-up transaction, in the user's locale. The checkbox now names them.
   - When a new version of a required document is published, `GET /me/legal` lists it as pending. The customer app shows a banner on the home screen and an "accept" screen. Accepting names the version seen; if a newer one was published meanwhile the API returns `409 VERSION_NOT_CURRENT`.
   - The merchant agreement is accepted per business by its owner (`onboarding.manage`). Submitting for review returns `422 MERCHANT_AGREEMENT_REQUIRED` while a published agreement has not been accepted. The onboarding page's existing agreement card links to the published text and records both the old onboarding flag and the versioned acceptance with one checkbox.
   - Other documents (return policy, prohibited items and so on) are published for reading. They are not separately accepted; the customer terms refer to them.
7. **Endpoints.** Public: `GET /legal`, `GET /legal/:kind`, `GET /legal/:kind/versions/:version`. Customer: `GET /me/legal`, `POST /me/legal/accept`. Business: `GET|POST /businesses/:id/legal/merchant-agreement[/accept]`. Admin: `GET|POST /admin/legal`, `GET|PATCH /admin/legal/:id`, `POST /admin/legal/:id/publish`. Every admin change and every acceptance is audited.
8. **Import.** `pnpm --filter @jays/api legal:import [--publish]` loads the draft files as version 1 of each kind, and publishes them outside production only.

## Consequences

- Blocking for launch: a UAE lawyer must review all twelve texts using `docs/legal/LEGAL_REVIEW_CHECKLIST.md`, fill in the `[●]` placeholders, and the founder must authorize recording the review and changing `LEGAL_REVIEW_COMPLETE`.
- Marketing consent is a policy document only. A separate opt-in toggle and its record are part of notification preferences and are not changed here.
- Customers who signed up before a published version existed have no acceptance and see the pending banner once documents are published.
- No new external service is used.
