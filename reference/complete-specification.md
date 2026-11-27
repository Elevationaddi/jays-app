# UAE Shopping & Services Marketplace — complete specification

# Product requirements
## Vision and scope
UAE B2C marketplace for retail goods and in-person beauty/wellness appointments. Three top-level roles: customer, business, admin. Business staff are permission-scoped members, not a fourth role. One identity can hold customer and business memberships; admin access is separately provisioned. Both customers and businesses see a Shop Products / Book Services gateway after sign-in. Customers can browse anonymously; business gateway switches management workspace. Hybrid merchants can activate both modes independently; unavailable mode displays onboarding, not a dead end. Keep a persistent mode switch and shared profile; never discard a cart on switch.
## MVP
Arabic/English, AED, UAE emirates, mobile-first customer experience, responsive merchant/admin portals. Categories: makeup, skincare, haircare, fragrance, fashion, accessories, bath/body; services: hair, nails, makeup, brows/lashes, spa, nonmedical wellness. Exclude medical procedures and regulated goods until separately approved. Product delivery by merchant or integrated courier; service at verified venues. One product checkout may contain multiple merchants; service booking is separate checkout. Single service per booking in MVP; multi-service itinerary later. Merchant sets inventory, price, duration, policies, hours; admin approves listings and merchant. No public listing before approval. No platform-held wallet or unlicensed escrow.
## Business model
Configurable product and service commission, optional subscriptions and promoted placements later; no fixed rate assumed. Capture rate/policy/tax on transaction. Business is seller/service provider unless legal review chooses another model. Platform payment provider must support UAE marketplace onboarding and payouts. No production payment launch until contract and tax treatment confirmed.
## Measures
Activation = approved merchant with first active listing; product conversion = paid checkouts / unique shop sessions; booking conversion = confirmed bookings / unique service sessions; GMV = captured gross less refunded amounts, separately by mode; track repeat purchase, cancellations, fulfillment SLA, disputes, net platform revenue. Never count test transactions.


---

# Customer screens and behavior
All routes below are app route identifiers, usable in mobile navigation. All screens require loading, empty, error, offline/retry states; preserve filters and scroll on back. Guest can browse; sign-in required at checkout and personal data screens.
| Route / tab | Contents and actions | Acceptance |
|---|---|---|
| /welcome | Language, emirate, two equal Shop Products and Book Services cards; optional location permission | Denial permits manual city; both choices work |
| /auth | Email/phone verification, sign in, reset, terms and optional marketing consent | Expired OTP rejected; rate limits; no role escalation |
| /shop | Search, campaign banners, categories, brands, curated collections, new arrivals, bestsellers | Only active approved in-stock or explicitly sold-out products; sponsored labeled |
| /shop/search | Search/autocomplete; category, brand, price, rating, availability, sort | Paginated results; clear filters; no hidden listings |
| /shop/category/:id | Category tree, product grid, subcategory chips | Valid category and localized labels |
| /shop/brand/:id | Brand story, collections, product grid | Brand may span merchants; seller shown |
| /shop/store/:id | Merchant profile, delivery and return policy, verified badge, products, services link | Only approved merchant data |
| /shop/product/:id | Gallery, description, ingredients/material, variants, stock, seller, delivery ETA, returns, verified reviews | Variant required; price updates; out-of-stock cannot add |
| /shop/saved | Wishlist, remove, add to cart | Persists across devices after login |
| /shop/cart | Group by seller; quantity, remove, promo, subtotal, delivery estimate | Reprice on server; stale items flagged |
| /shop/checkout | Address, delivery option per seller, totals, payment, consent | No charge before final total; idempotent |
| /orders | Order history and status, grouped shipments | Own orders only |
| /orders/:id | Timeline, tracking, invoice, cancel eligible items, return request, support, review | Partial refunds shown separately |
| /services | Location, category chips, search, nearby venues, popular services, date filters | Manual location always available |
| /services/search | List/map toggle, distance, price, rating, availability, category, sort | Availability checked on server; no invented slots |
| /services/venue/:id | Photos, address/map, hours, policies, services with duration/price, team, reviews | Book button only for eligible services |
| /services/venue/:id/service/:sid | Service details, add-ons if enabled, preparation, duration, price | Service and venue association validated |
| /services/book/staff | Any eligible professional or named staff | Only qualified staff at selected branch |
| /services/book/time | Date strip, available slots, timezone, summary | Selecting time creates short hold; expiry displayed |
| /services/book/confirm | Customer contact, policy, total, payment, confirmation | No confirmation until server verifies payment |
| /appointments | Upcoming/past/canceled, rebook | Own bookings only |
| /appointments/:id | Venue directions, service/staff/time, reschedule, cancel, receipt, support, review | Policy applies; reschedule atomic |
| /services/saved | Saved venues | Removed venue shown unavailable or omitted |
| /account | Profile, language, addresses, privacy, payment methods via PSP, notifications, support, logout, deletion request | Sensitive changes reauthenticate |
| /support | Ticket type, transaction reference, attachments, history | Ownership enforced; no cross-user visibility |
Customer tabs: Shop mode Home, Categories/Search, Saved, Cart, Account; Service mode Explore, Search, Saved, Appointments, Account. Shared account links both orders and appointments; notifications deep-link to appropriate mode. Accessible mode switch in every main tab.


---

# Business portal
## Onboarding
Register owner, verify contact, enter legal name, trade license number/expiry/authority, business address, tax registration if applicable, bank/PSP onboarding, storefront names and Arabic/English content, choose product/service/both, accept merchant agreement. Status draft → submitted → under_review → approved/rejected; resubmit with reason. Suspension blocks new sales/bookings but retains fulfillment/support obligations. Private documents visible only authorized reviewers and owner.
| Route / tab | Contents and actions | Rules / acceptance |
|---|---|---|
| /business/gateway | Product management and service management cards, activate mode, switch business | Only memberships accessible |
| /business/shop/dashboard | Sales, orders, low stock, refunds, net revenue | Date filters; distinguish gross and net |
| /business/shop/products | Search, filter, add/edit/archive, draft/submit | No self approval; archive keeps history |
| /business/shop/products/:id | Arabic/English title, category, brand, SKU, media, variants, barcode optional, ingredients/material, price, tax class, stock, shipping size/weight, return eligibility | Unique SKU per merchant; positive price; validated media |
| /business/shop/inventory | Stock on hand/reserved/available, stock adjustments, reasons, low stock alerts | Transactional adjustments; no negative stock |
| /business/shop/orders | New, processing, shipped, delivered, canceled | Merchant sees only own suborders |
| /business/shop/orders/:id | Packing, tracking, shipment status, cancellation, refund request | No editing paid price; audited actions |
| /business/shop/returns | Requests, evidence, approve/reject with reason, receipt, refund status | Admin escalation; refund not marked until PSP confirms |
| /business/shop/store | Logo, banner, bilingual profile, delivery zones and fees, return policy | Admin reviews material changes |
| /business/services/dashboard | Bookings, occupancy, revenue, cancellations | Branch filter, daily/weekly views |
| /business/services/calendar | Day/week, staff columns, booking detail, blocks, manual bookings | Same availability checks as customer; no double bookings |
| /business/services/catalog | Service categories, names, photos, duration, buffers, price, eligibility, branch, assigned staff, cancellation policy | Positive duration, fixed price MVP; changes do not alter paid bookings |
| /business/services/team | Invite staff, profile, qualifications, branch/service assignment, shifts, breaks, leave | Staff sees own appointments unless granted manager permission |
| /business/services/branches | Address, coordinates, hours, closure dates, photos, policies | Approved branch required for public bookings |
| /business/services/appointments | Filter, view, check-in, complete, no-show, cancel/reschedule with reason | Cannot complete canceled appointment; notify client |
| /business/services/clients | Own customers, booking history, consent flags | Minimum data; no marketing without consent |
| /business/finance | Transaction ledger, fees, refunds, payout balances/status, statements | Read-only financial history; exports scoped |
| /business/promotions | Create seller-funded coupons, dates, limits, eligible items/services | Server validates; no negative total |
| /business/reviews | View and respond, report abuse | Cannot delete customer reviews |
| /business/settings | Team permissions, legal documents, notifications, support, language | Sensitive actions require owner/reauthentication |
Navigation: product sidebar Dashboard, Products, Inventory, Orders, Returns, Store; service sidebar Dashboard, Calendar, Services, Team, Branches, Appointments, Clients; shared Finance, Promotions, Reviews, Settings. Staff subpermissions: owner, manager, fulfillment, scheduler, finance, professional. Default deny; owner cannot grant platform admin.


---

# Admin console
Separate web console, MFA required, invite-only. Platform roles: superadmin, compliance, catalog, operations, finance, support, analyst. Enforce permission on every API, require reason for destructive or financial action. No impersonation in MVP.
| Route | Screen and actions |
|---|---|
| /admin/dashboard | GMV by mode, active merchants, bookings, orders, pending verification, disputes, payout exceptions, filters |
| /admin/businesses | Review legal docs, verify license expiry, approve modes/branches, reject with reason, suspend/reactivate |
| /admin/customers | Search accounts, support history, restrict abusive accounts, privacy requests; masked PII |
| /admin/products | Review listings, categories, claims, restricted goods, brands, takedowns |
| /admin/services | Review services, venues, staff eligibility, prohibited treatments, moderation |
| /admin/orders | Cross-merchant fulfillment monitoring, timeline, disputes, eligible refunds |
| /admin/bookings | Appointment monitoring, cancellations, disputes, exception handling |
| /admin/finance | Payments, reconciliation, commission rules, payout holds, refund approval, exports |
| /admin/content | Banners, collections, category taxonomy, localized copy, scheduled publishing |
| /admin/promotions | Platform coupons, funding and usage caps, sponsored disclosure |
| /admin/reviews | Abuse reports, evidence, hide/restore with reason |
| /admin/support | Ticket queues, assignments, SLA, internal notes, customer communications |
| /admin/security | Admin invites, permissions, audit logs, access reviews |
| /admin/settings | Policy versions, emirates, feature flags, integrations, notification templates |
Acceptance: finance changes are versioned and effective-dated; refunds above configurable threshold require two distinct approvers; audit log records actor, timestamp, target, before/after redacted fields, reason; exports logged; suspension never silently cancels existing transactions.


---

# Workflows and state machines
## Product checkout
1. Server validates active merchant, SKU, stock, address zone and promo; calculates totals in integer fils and returns expiring quote. 2. Lock variant rows in stable ID order; atomically reserve stock and create pending order with merchant suborders. 3. Create PSP payment intent using idempotency key. 4. Verified webhook confirms payment, converts reservation into stock deduction, marks suborders paid and queues notifications. 5. Merchant processes → ships with tracking → delivers. 6. Customer may request eligible cancellation/return; support handles dispute; refund on PSP confirmation updates ledger. Timeout releases reservations; late successful payment triggers automatic refund or manual exception if refund fails. Duplicate webhooks no-op.
Order payment states: pending → paid/failed/expired; paid → partially_refunded/refunded. Fulfillment per suborder/item: pending_payment → paid → processing → shipped → delivered; cancel before dispatch if eligible; post-dispatch return workflow separate. Return: requested → approved/rejected → received → refund_pending → refunded/failed. Restock only after physical inspection and explicit adjustment.
## Appointment
Search service+branch+date; eligibility intersects business hours, staff shifts, staff-service assignment, breaks, leave, existing appointments and holds, duration and buffers. Generate 15-minute start grid (configurable), UTC storage, Asia/Dubai display. Customer selects any staff or named; server deterministically allocates eligible staff within transaction. Create hold for 10 minutes; exclusion constraint prevents overlapping active staff intervals including buffers. Confirm on verified PSP payment; late success without valid hold refunded. Confirmed → checked_in → completed; confirmed → canceled/no_show; staff can mark no-show only after start plus configurable grace. Reschedule locks new interval before releasing old in same transaction; failure retains old; price-changing reschedule MVP requires cancel/rebook with policy disclosure. Merchant cancellation refunds full payment; customer cancellation uses versioned policy with exact cutoff. Booking payment separate from order.
## Reviews and support
Verified delivered item or completed appointment, one review per eligible item/booking, stars 1–5 and text, moderation; merchant reply once editable with history. Ticket open → assigned → awaiting_reply → resolved → reopened. Store participant-visible messages separate from internal notes.
## Payouts
Gross captured amount minus merchant-funded discounts (already reflected in gross), refunds, platform commission and applicable fees/tax = merchant payable; platform-funded discounts recorded separately as subsidy. Use balanced immutable ledger entries; never calculate payout from UI totals. Payout eligibility after delivery/completion and configurable dispute window; PSP payout pending → paid/failed/reversed; reconcile daily; negative balance carried or recovered under agreement. No payout on unresolved dispute. Define tax/fee allocation with accountant before enabling live mode.


---

# Architecture and database contract
Proposed stack (not mandated): TypeScript monorepo pnpm; Expo React Native customer app; Next.js responsive business/admin web; NestJS REST API; PostgreSQL + Prisma with raw SQL migrations for range constraints; Redis for queues/rate limits, not authoritative locks; S3-compatible private/public object storage; background workers for notifications/reconciliation. Provider adapters for PSP, maps, delivery, email/SMS/push. Use supported stable versions pinned at implementation. API is source of truth; no direct database access from clients. Local Docker Postgres/Redis, mock providers. Production separate environments and secrets.
## Entities
Every table UUID PK, created_at/updated_at UTC unless immutable. FK indexes; soft archive commercial entities. Monetary fields integer AED fils, currency AED; percentage basis points. Localized content {en,ar}; version policy snapshots. Tables (key fields):
- users(email unique nullable, phone unique nullable, status, locale); sessions(user_id, refresh_hash, expires_at); addresses(user_id, emirate, area, street, building, unit, lat/lng optional).
- businesses(legal_name, status, license_expiry, tax_id, psp_account_ref); memberships(user_id,business_id,permission, unique pair); business_modes(business_id,mode,status, unique pair); verification_docs(business_id,private_object_key,review_status); branches(business_id,address,timezone,status).
- categories(parent_id,mode,name); brands(name,status); products(business_id,category_id,brand_id,status,title,description,policy_version); variants(product_id,business_id,sku,attributes,price_fils,tax_class,stock_on_hand,stock_reserved, unique business_id+sku); stock_movements(variant_id,delta,reason,actor_id); media(owner_type,owner_id,object_key,sort_order).
- carts(user_id,status); cart_items(cart_id,variant_id,qty,unique pair); quotes(user_id,type,total_fils,breakdown,expires_at); orders(user_id,quote_id,status,total_fils,address_snapshot); merchant_orders(order_id,business_id,status,delivery_fils); order_items(merchant_order_id,variant_id,qty,unit_price_fils,tax_fils,discount_fils,snapshot); reservations(order_id,variant_id,qty,expires_at,status); shipments(merchant_order_id,tracking_ref,status); returns(order_item_id,qty,reason,status).
- services(business_id,category_id,title,price_fils,duration_min,buffer_before,buffer_after,status); branch_services(branch_id,service_id); staff(business_id,membership_id nullable,display_name,status); staff_branches(staff_id,branch_id); staff_services(staff_id,service_id); shifts(staff_id,branch_id,weekday,start_local,end_local); schedule_blocks(staff_id,start_at,end_at,reason); branch_hours(branch_id,weekday,start_local,end_local); closures(branch_id,start_at,end_at); bookings(user_id,business_id,branch_id,service_id,staff_id,start_at,end_at,occupied_start,occupied_end,status,hold_expires_at,price_fils,policy_snapshot,source).
- payments(target_type,target_id,provider_intent_id unique,amount_fils,status); webhook_events(provider,event_id unique,payload_hash,processed_at); refunds(payment_id,amount_fils,status,provider_ref unique); ledger_entries(transaction_id,account_id,debit_fils,credit_fils,currency); payouts(business_id,amount_fils,provider_ref,status); fee_rules(mode,business_id nullable,bps,effective_at); policies(business_id,mode,version,body,effective_at).
- favorites(user_id,target_type,target_id,unique triple); reviews(user_id,order_item_id nullable,booking_id nullable,rating,body,status); promotions(code,scope,funder,discount,usage_cap,starts_at,ends_at); redemption(promotion_id,user_id,target_id); tickets(user_id,business_id nullable,transaction_ref,status); messages(ticket_id,actor_id,visibility,body); notifications(user_id,type,payload,read_at); audit_logs(actor_id,action,target,reason,redacted_diff); outbox(event_type,payload,status,attempts).
## Invariants
CHECK stock_on_hand >= stock_reserved >= 0; qty > 0; amounts nonnegative; review XOR order item/booking; unique review per eligible target; one effective fee rule precedence merchant > platform; ledger debits equal credits per transaction (deferred validation). PostgreSQL btree_gist exclusion on staff_id WITH = and tstzrange(occupied_start,occupied_end,'[)') WITH && for status in ('held','confirmed','checked_in'); expire holds transactionally before allocation. Schedule changes conflicting with existing confirmed bookings must be rejected or resolved explicitly. Enforce same-merchant relationships with composite FKs or transaction checks. Polymorphic targets must be validated; prefer concrete FKs in final migration. No hard deletion of financial records; redact/anonymize personal data as permitted.


---

# REST API contract (v1)
Base /v1; JSON; authenticated bearer access token with rotating refresh token; business context derived from verified membership. All list endpoints cursor pagination {items,nextCursor}; filter/sort allowlist. Errors {error:{code,message,fieldErrors?,requestId}}; codes 400 validation, 401 auth, 403 permission, 404 absent/hidden, 409 conflict, 422 policy, 429 rate limit. Idempotency-Key required for financial mutations, reservations, checkout, reschedule; scope to actor+route, hash request, return previous response on identical retry, 409 if changed. Never accept client totals or role claims.
| Method / path | Access | Contract |
|---|---|---|
| POST /auth/register, /auth/verify, /auth/login, /auth/refresh, /auth/logout | public/session | validated identity, token rotation |
| GET/PATCH /me; CRUD /me/addresses | customer | own data |
| GET /categories, /brands, /products, /products/:id, /stores/:id | public | approved visible records, query/filter/cursor |
| GET /venues, /venues/:id, /venues/:id/services, /venues/:id/staff | public | location/category/date filters |
| GET /availability?branchId&serviceId&date&staffId | public | slots [{startAt,endAt,staffId?}], no guarantee until hold |
| GET /cart; PUT/DELETE /cart/items/:variantId | customer | qty integer; server totals estimates |
| POST /checkout/quote | customer | addressId, shipping choices, promo; returns quoteId, expiry, breakdown |
| POST /orders | customer | quoteId; returns orderId, paymentClientSecret, status |
| GET /orders, /orders/:id; POST /orders/:id/cancel | customer | own order; eligible item IDs and reason |
| POST /returns | customer | orderItemId, qty, reason, evidence refs |
| POST /bookings/hold | customer | branchId, serviceId, staffId optional, startAt; returns bookingId, assignedStaffId, expiry, amount |
| POST /bookings/:id/pay | customer | bookingId; returns paymentClientSecret |
| GET /bookings, /bookings/:id | customer | own history |
| POST /bookings/:id/cancel, /reschedule | customer/business | reason or newStartAt/newStaffId; policy enforced |
| POST/DELETE /favorites; POST /reviews | customer | verified target and ownership |
| POST /businesses; POST /businesses/:id/submit | owner | draft legal info, mode, documents |
| GET/PATCH /businesses/:id | member | scoped permissions |
| CRUD /businesses/:id/products, /variants, /branches, /services, /staff, /shifts, /blocks, /promotions | member | scoped validated resources; deletion means archive |
| POST /businesses/:id/inventory/adjust | fulfillment | variantId, delta, reason |
| GET /businesses/:id/orders, /bookings, /calendar, /finance, /clients | member | permission-scoped data |
| POST /businesses/:id/orders/:orderId/transition | fulfillment | nextStatus, tracking optional |
| POST /businesses/:id/bookings/:bookingId/transition | scheduler | nextStatus, reason |
| POST /businesses/:id/manual-bookings | scheduler | same slot rules, customer consent, payment status explicit |
| GET/POST /tickets; POST /tickets/:id/messages | authorized | participant visibility |
| GET /admin/:resource; POST /admin/:resource/:id/actions | admin scoped | typed action allowlist, reason, version precondition |
| POST /webhooks/payments | PSP | raw body signature, event replay protection |
## Examples
POST /bookings/hold request: {"branchId":"uuid","serviceId":"uuid","startAt":"2027-01-02T10:00:00+04:00"}. Response 201: {"bookingId":"uuid","assignedStaffId":"uuid","status":"held","expiresAt":"ISO-8601","amountFils":12000,"currency":"AED"}. Conflict 409 SLOT_UNAVAILABLE.
POST /orders request {"quoteId":"uuid"}; 201 {"orderId":"uuid","status":"pending_payment","paymentClientSecret":"provider-token"}. Client polls order status or receives push; redirect alone never confirms payment.
Generate OpenAPI 3.1 from implemented DTOs; add request/response examples and contract tests. CRUD shorthand above is a route family; expand collection GET/POST and item GET/PATCH/DELETE in OpenAPI. Never expose PSP secrets except client-scoped intent token.


---

# UX and design system
Original working design: warm white surfaces, charcoal text, muted plum accent (proposed, not final brand), accessible contrast, 8-point spacing, 16px minimum body, 44pt touch targets. Arabic RTL mirrored layout and appropriate Arabic typeface; prices and times readable, images not mirrored. Use localized strings, no hard-coded UI copy. Product discovery editorial: large campaign, category tiles, 2-column product cards, brand collections, wishlist hearts, sticky add-to-cart. Service discovery location-first: venue cards with photos, rating/count, distance if known, starting price, next available if verified, map toggle, sticky Book button. Do not copy competitor icons, assets, exact layouts or branding.
Gateway wireframe: shared header with logo/profile, two prominent cards [Shop Products] [Book Services], secondary recent activity, switcher in header. Business gateway mirrors choice with management labels, approval badges and setup action. Product page: image gallery → title/brand/seller → price/variant → delivery/returns → reviews → sticky CTA. Service venue: gallery → venue/address/rating → service list → team → reviews → policies → booking CTA. Booking stepper service → staff → time → review/pay → success. Cart and booking holds independent. Admin desktop uses sidebar, filters, paginated tables, detail drawers, reason dialogs; business calendar uses staff lanes and day/week toggle.
Accessibility: screen-reader labels for ratings/availability, focus management, dynamic text, no color-only statuses, keyboard access web, reduced motion. Display total and policy before charge. Skeleton, retry, empty and offline states; offline cannot submit booking/payment. Test Arabic RTL, narrow 360px view and large fonts.


---

# Security, compliance and QA
## Security
Argon2id password hashes if password auth used; verified email/phone, OTP expiry and throttling; admin MFA; short access token, refresh rotation/revocation; secure keychain mobile, HttpOnly secure cookies web with CSRF protection as applicable. TLS, encrypted storage, secret manager, strict CORS, input validation, output encoding, parameterized DB queries. Signed upload URLs, content type/size validation and malware scan; legal docs private. Payment hosted UI/tokenization; never store PAN/CVV. Audit access to PII, redact logs and exports, backups encrypted, restoration tested. Prevent IDOR by scoped queries; test all role boundaries. Account deletion request process with statutory retention exceptions. Incident plan, alerting, breach assessment and notification process.
## UAE launch gates
Verify marketplace and merchant license activities, consumer disclosures in Arabic, seller identity and invoice obligations, applicable product registration/labeling (cosmetics/perfumes), service venue permissions, UAE personal data rules and cross-border processing, VAT agency/principal treatment and invoices, PSP marketplace approval and payout terms. Publish privacy, merchant, buyer, returns, booking/no-show and complaints policies. Legal counsel/accountant must validate; no legal compliance certification implied. Sources: https://u.ae/en/information-and-services/business/ecommerce/ ; https://u.ae/en/information-and-services/justice-safety-and-the-law/consumer-protection ; https://tax.gov.ae/ .
## Acceptance tests (automate)
T01 guest browses both modes; login preserves cart; business hybrid switch preserves workspace. T02 pending merchant/listing invisible; approved visible; suspension blocks new checkout. T03 customer A cannot read B orders, business A cannot read B inventory, staff cannot payout, admin requires MFA. T04 two simultaneous purchases of last unit: only one reservation succeeds. T05 multi-seller order splits, shipping and taxes reconcile; duplicate checkout returns same ID. T06 failed/expired payment releases inventory; late payment handled; webhook replay does not duplicate ledger. T07 staff shifts/breaks/leave/branch closures and buffers block slots; two simultaneous holds for same staff interval only one wins. T08 any-staff allocation chooses qualified staff; expired hold releases; reschedule conflict preserves original. T09 cancellation boundary and merchant cancellation refund correct; partial refund cannot exceed capture; payout blocked by dispute. T10 review only after delivery/completion; moderation audited. T11 Arabic RTL and English, accessibility, offline retry, no location permission. T12 backup restore, webhook signature failure, upload rejection, rate limits, notification retry. T13 price/policy changes do not mutate historical orders or bookings. T14 timezone display and midnight boundaries. T15 reconciliation captures missing webhook and flags mismatch. T16 admin approval threshold requires separate actors. Test unit calculations/state transitions, integration real PostgreSQL concurrency, API contract, E2E mobile/web, load and security scans.


---

# Implementation plan and delivery gates
0. Scaffold monorepo, local Docker, environment schema, lint/typecheck/test CI, ADRs. 1. Identity, role enforcement, business membership, bilingual gateway. 2. Merchant onboarding, admin approval, categories, media and storefront. 3. Product catalog, inventory transactions, cart/quote, multi-seller checkout with mock PSP. 4. Services, branches/staff/shifts, availability exclusion constraint, booking hold/payment and calendar. 5. Real PSP adapter sandbox, verified webhooks, ledger, refunds/payouts reconciliation. 6. Fulfillment, reviews, support, notifications, admin dashboards and exports. 7. RTL/accessibility, concurrency/security tests, backups, observability, staging and pilot. Each phase requires migrations, seed data, unit/integration tests, screenshots for UI, passing CI, updated OpenAPI and README. Do not implement later phase to conceal failing prior gate.
Repository proposal: apps/customer, apps/business, apps/admin, apps/api, apps/worker; packages/domain, db, ui, i18n, contracts, config; docs; infra; tests/e2e. Env examples DATABASE_URL, REDIS_URL, JWT_KEYS, STORAGE_BUCKET, PSP_API_KEY, PSP_WEBHOOK_SECRET, MAPS_KEY, EMAIL_KEY; never commit secrets. Local seed: 2 product sellers, 1 salon, 1 hybrid, multiple branches/staff, English/Arabic listings, test customers and admin; fictional data only. Mock payment outcomes success/fail/timeout/duplicate; dev-only switches prohibited in production. Observability: structured request IDs, error rates, p95 latency, queue lag, expired holds, reconciliation mismatch, alerts. Proposed targets p95 read <500ms under pilot load, zero double booking/oversell, daily backups with tested restore; validate with load test.
## Decisions requiring founder approval before production
Brand/name, commission and subscription rates, merchant of record, VAT/invoice handling, PSP, payout delay, return/cancellation windows, delivery partners and zones, whether home services supported, regulated service categories, operating emirates and support hours. MVP defaults: in-venue only, prepaid appointments, merchant delivery, no subscription, no cash on delivery, no multi-service booking, no medical services. All proposed defaults are configurable or documented; no invented live credentials.
## References and later scope
Boutiqaat public listing https://apps.apple.com/us/app/boutiqaat-%D8%A8%D9%88%D8%AA%D9%8A%D9%82%D8%A7%D8%AA/id1021268294 (catalog inspiration); Fresha https://www.fresha.com/for-business/features/marketplace and https://www.fresha.com/help-center/knowledge-base/online-presence/102398-learn-how-clients-book-appointments-online (booking inspiration). Public feature research only; no access to internal source or proprietary blueprint. Later: influencer boutiques/video, loyalty, recommendations, multi-service appointments, memberships, home services, native business app, POS, courier integration, subscriptions, advanced marketing. Do not build before MVP acceptance.
