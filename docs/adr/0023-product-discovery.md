# ADR-0023: Product discovery

Status: Accepted (technical design). Showing a was-price is a consumer-protection matter: the merchant must be able to show the earlier price was genuine. The wording of that rule in the merchant terms is a **legal question that is still open** (see ADR-0018 legal items).

Date: 2026-11-28

## Context

Phase 8 asks for Boutiqaat-level product browsing. Phase 3 (ADR-0013) shipped a public product list with a text search, category, brand, store, price and stock filters, and newest or price sorts. The customer app had no search or filter screen, no wishlist and no way to hear when a sold-out product returns. The home screen's category chips did nothing and its "recent activity" section was a fixed message.

## Decision

1. **Sale prices.** A variant may carry `compare_at_fils`, which the database requires to be above the price. The merchant enters it in the business portal; blank means no sale.
   - Raising the price to or above the was-price ends the sale (the was-price is cleared and audited) instead of failing.
   - A product's list item shows the cheapest variant's was-price and the largest saving across variants, rounded down to a whole percent, so a badge never overstates the saving.
2. **Ratings** are computed from published product reviews only. Reviews are tied to delivered order lines (ADR-0016), so every rating comes from a verified purchase. Hidden reviews do not count. Nothing is cached, so a moderation decision shows at once.
3. **Sorts and filters.** The list adds:
   - sorts `rating` (average, highest first), `popular` (units in orders paid in the last 90 days) and `discount` (largest saving);
   - filters `onSale` and `minRating`;
   - text search over titles and brand names in both languages.
     Each sort pages with the same opaque `[key, id]` cursor as before, using an integer key, so paging never skips or repeats a product.
4. **Facets.** `GET /products/facets` returns the total, the price range, the number on sale and in stock, and brand counts for the same filters. Brand counts ignore the brand filter so the customer can switch brands.
5. **Related products.** `GET /products/{id}/related` returns up to 8 other products in the same category, in stock first, then best sellers.
6. **Wishlist** (`wishlist_items`): up to 200 products per customer, saved idempotently. Only a product on sale can be added (404 otherwise). A product that later leaves sale stays listed with `product: null` so the customer can see and remove it.
7. **Back-in-stock alerts** (`stock_alerts`): a customer can watch up to 50 sold-out options. Watching an option that is in stock answers 409 `IN_STOCK`.
   - A trigger on `variants` fires when an option becomes available again through any path: a restock, a cancelled order, a released reservation or re-activation. In the same transaction it marks every open alert for the option as notified and queues one `product.back_in_stock` outbox event per alert.
   - The notification dispatcher sends it in the app, and by email where allowed (D14), in the customer's language, linking to the product. A product no longer on sale is not announced.
   - Stock is never held for the customer. The message says so.
8. **Recently viewed** products are kept on the device only (the last 10), not on the server.
9. **Account deletion** (ADR-0019) deletes the customer's wishlist and alerts.

## Consequences

- Ratings and sales counts are computed per query with indexed joins. That is fine for the pilot's size (about 30 shops). A materialised summary can replace the joins later without changing the API.
- "Popular" counts paid orders, including ones later refunded. Excluding refunds needs the refund lines per product and can come later.
- An alert fires once. A customer who misses the restock has to ask again.
