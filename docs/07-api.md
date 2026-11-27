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
