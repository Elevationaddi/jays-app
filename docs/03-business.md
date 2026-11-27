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
