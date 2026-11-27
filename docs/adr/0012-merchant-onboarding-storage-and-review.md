# ADR-0012: Merchant onboarding, private files and admin review

- Status: Accepted (engineering). The merchant agreement text, the PSP and medical categories stay founder decisions (ADR-0007 D5, D10, D13).
- Date: 2026-11-27

## Context

Phase 2 lets a business prove who it is, lets the platform approve it, and only then shows its storefront to customers (docs/03-business.md, docs/04-admin.md, T02). That needs a review state machine that two reviewers cannot race, private document storage with signed links, image uploads that are checked before anyone sees them, and a clear rule for what is public.

## Decision

**State machines.** The business has `draft → submitted → under_review → approved | rejected`, with `rejected → submitted` for a resubmission and `approved ⇄ suspended`. Each mode (shop, services) is reviewed on its own: `onboarding → pending_review → active | rejected`. The transition table lives in `packages/domain/src/onboarding.ts` and is shared by the API, the admin console and tests. An approved hybrid business can submit its second mode later without leaving `approved`.

**Admin actions are a typed allowlist.** `POST /v1/admin/businesses/{id}/actions` takes one of nine actions (start_review, approve, reject, approve_mode, reject_mode, suspend, reactivate, approve_storefront_changes, reject_storefront_changes). Rejecting, suspending, reactivating and refusing storefront changes need a written reason, which is shown to the merchant and kept in the audit log. Each action needs a platform capability (`ACTION_CAPABILITY`): compliance and superadmin review businesses, operations can also suspend, and catalog can review storefront changes. The business row is locked `FOR UPDATE`, and every request carries `expectedVersion`. `businesses.version` goes up on every merchant or admin change, so a decision made on stale information answers 409 `VERSION_CONFLICT` instead of overwriting another reviewer's. Every action writes an audit entry and an outbox event in the same transaction.

**What the merchant can change.** The legal profile, address, tax registration and documents can be edited only in `draft` or `rejected` (409 `PROFILE_LOCKED` otherwise). Submission runs the same checklist the portal shows: legal name, licence number, authority and an unexpired expiry date (UAE date), full address, a 15-digit TRN when tax-registered, a clean trade licence (and tax certificate when registered), bilingual storefront name and description, the current agreement version, and at least one activated mode.

**Storefront draft and live copy.** Merchants edit draft columns. Approval copies the draft to `live_*` columns and sets `published_at`. After approval, edits set `changes_submitted_at` and wait for review, while customers keep seeing the live copy. The storefront is locked while the business is under review (409 `IN_REVIEW`).

**Public visibility.** A store is listed only when the business is `approved`, the storefront has been published and the mode is `active`. Public endpoints (`/v1/stores`, `/v1/stores/{id}`, `/v1/media/{id}`) read only live columns, so a draft is never exposed. Suspension hides the store on the next request. `/v1/media/{id}` answers a 302 to a short-lived signed URL, and only while the image is part of a visible storefront's live content.

**Files.** An upload is a ticket: the API creates a pending row and returns a signed PUT URL valid for 10 minutes. The client PUTs the bytes, then calls `complete`. The server then checks the real type from magic bytes (PDF, JPEG, PNG for documents; JPEG, PNG, WebP for images), the size (10 MB documents, 5 MB images), image dimensions per purpose (logo at least 200×200 and roughly square; banner at least 1200×300 with a 2:1 to 5:1 ratio), and runs the malware scanner. A refused file is deleted from storage and the reason is recorded. Documents live under `private/` and are downloaded through 5-minute links that only the owner and `documents.view` admins can get, and every download is audited. Composite foreign keys keep a storefront from pointing at another business's media.

**Adapters.** `ObjectStorage` and `MalwareScanner` are interfaces. Locally, `LocalObjectStorage` keeps files on disk (`STORAGE_LOCAL_DIR`) and serves HMAC-signed tokens at `/v1/storage/objects/{token}` (excluded from OpenAPI). `MockMalwareScanner` flags the EICAR test string. Production refuses `STORAGE_PROVIDER=local`, `MALWARE_SCANNER=mock` and a non-https `API_PUBLIC_URL` at boot, so a deployment cannot quietly run on the mocks. The S3-compatible adapter and a real scanner come with the hosting decision.

**Taxonomy.** Categories belong to one mode and nest at most three levels. A trigger sets the depth, and the parent cannot change after creation. A category with active children cannot be archived. The MVP tree (7 shop and 6 services top-level categories) is seeded by the migration. Medical procedures and regulated goods are left out until the founder approves them (D10). Brands are a flat list. Only `active` entries are public.

**Payouts.** No bank or PSP onboarding data is collected until the provider is chosen (D5). The portal says so plainly instead of showing a form that goes nowhere.

## Consequences

- One reviewer action is one transaction with an audit entry. Two reviewers on the same version cannot both win (integration test).
- The portals relay uploads through their own server (Server Actions, 11 MB body limit), so the browser never sees a signed URL. Direct browser uploads would cut that hop and are a follow-up once a CDN or bucket CORS policy exists.
- Expired pending uploads are not cleaned up yet. That is a worker job for phase 6 or 7.
- Admins review documents as part of the business decision. There is no separate approve or reject per document yet.
- A licence that expires after approval does not suspend the business automatically. Renewal reminders and expiry handling are follow-ups.
