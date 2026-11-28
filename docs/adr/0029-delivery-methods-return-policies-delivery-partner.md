# ADR-0029: Delivery methods, return policies and an optional delivery partner

Status: Accepted (technical design). The return rules (a minimum of 14 days, category exclusions and the faulty-item exception) are **proposed** until a UAE lawyer confirms the statutory minimums (legal review checklist 4.4). No paid delivery provider is used.

Date: 2026-11-28

## Context

D8 says sellers deliver their own orders, with zones per emirate (ADR-0013). Phase 8.8 adds delivery methods, delivery zones, tracking links, an optional delivery-partner interface with no mandatory paid provider, return policies and refund workflows. The founder's cost constraint (ADR-0024) rules out paid logistics providers without approval.

Before this change:

- each business had one fee per emirate;
- every order had the platform's fixed 14-day return window;
- the product-level "returns accepted" flag was shown to customers but not enforced;
- tracking was entered by hand.

## Decision

1. **Delivery methods.** A delivery zone is now per emirate and method: `standard` or `express`. Uniqueness is (business, emirate, method).
   - The quote lists every method each seller offers to the address, with the fee this order would pay (after any free-delivery threshold).
   - The customer can choose a method per seller. The default is standard, otherwise the cheapest.
   - Asking for a method a seller does not offer returns `422 DELIVERY_METHOD_UNAVAILABLE`. The choice is never changed silently.
   - The method is stored in the quote and copied into the order's delivery snapshot. Placing an order re-prices with the same methods. If a method was withdrawn after the quote, the API returns `409 QUOTE_STALE`.
   - Pickup is not built. It needs branch addresses for shops, so it is left for later.
2. **Return policy per business.**
   - `businesses.return_window_days` is 14 to 90 days and defaults to 14. A business can offer more than the platform default but never less, until a lawyer sets the statutory minimum.
   - There is an optional English and Arabic note, edited under Delivery and returns in the business portal.
3. **Non-returnable items.**
   - Admins can mark a shop category non-returnable (for example opened hygiene products). Everything beneath that category is excluded too.
   - The product's existing "returns accepted" flag is now enforced.
4. **Snapshots.**
   - When an order is placed, the window is copied onto the merchant order, and each item's returnability onto `order_items.returnable` (T13). Later changes never affect that order.
   - Orders placed before this change have no window and use the platform default.
5. **Faulty items.**
   - A return of a non-returnable item returns `422 ITEM_NOT_RETURNABLE`, unless the customer reports the item as faulty or not what they ordered. The request then goes to the business like any other return.
   - The request records `faulty`. Customers see the window, the "return until" date and which items are faulty-only.
6. **Delivery partner interface.**
   - `DeliveryPartner.createShipment()` returns a carrier, a tracking number and an https tracking link.
   - `DELIVERY_PARTNER=none` (the default) means businesses enter tracking themselves.
   - `mock` books fictional shipments with links on a reserved test domain. Production refuses `mock`, like the other mock adapters.
   - Shipping with `usePartner: true` asks the adapter for the tracking and records `merchant_orders.delivery_partner`. The business order page offers it only when a partner is configured.
   - A real courier needs founder approval, its own adapter, and idempotency per suborder, because the call happens inside the shipping transaction.
7. **Tracking links** stay https-only. Customers see them on the order.

## Consequences

- Refund workflows are unchanged: returns still go through approval, receipt and a refund of the items only (ADR-0016). Delivery and travel fees reverse no commission (ADR-0027).
- Return windows are counted from `delivered_at`, which the business records. A courier's proof of delivery would replace that once a partner exists.
- Area-level zones inside an emirate are not built. Addresses store the area as free text, so matching would be unreliable; this is left for later.
- No new external service is used.
