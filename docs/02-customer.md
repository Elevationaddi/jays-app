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
