-- Phase 8.6: product discovery (ADR-0023).
--
-- 1. A variant can show a was-price (compare-at), always above its price. The merchant is
--    responsible for it being a genuine earlier price (UAE consumer protection).
-- 2. Wishlists: products a customer saved.
-- 3. Back-in-stock alerts: a customer asks to be told when a sold-out variant returns. The alert
--    is used once: it is marked notified when the variant is available again.
-- 4. Product ratings and sales counts used for sorting and badges are computed from published
--    reviews and paid order lines; indexes keep those lookups cheap.

ALTER TABLE variants ADD COLUMN compare_at_fils integer
  CHECK (compare_at_fils IS NULL OR compare_at_fils > price_fils);

CREATE TABLE wishlist_items (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX wishlist_items_product_idx ON wishlist_items (product_id);
CREATE INDEX wishlist_items_user_recent_idx ON wishlist_items (user_id, created_at DESC);

CREATE TABLE stock_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
-- One open alert per customer and variant.
CREATE UNIQUE INDEX stock_alerts_open_key ON stock_alerts (user_id, variant_id)
  WHERE notified_at IS NULL;
CREATE INDEX stock_alerts_variant_open_idx ON stock_alerts (variant_id) WHERE notified_at IS NULL;


-- Account deletion (ADR-0019) drops wishlists and alerts with the personal data.
CREATE FUNCTION scrub_deleted_user_discovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM wishlist_items WHERE user_id = NEW.id;
  DELETE FROM stock_alerts WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_deleted_scrub_discovery AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION scrub_deleted_user_discovery();

-- When a variant becomes available again (restock, cancellation, released reservation or
-- re-activation), every open alert for it is marked notified and queued for the notification
-- dispatcher in the same transaction. The rule lives here so every stock path triggers it.
CREATE FUNCTION notify_back_in_stock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH done AS (
    UPDATE stock_alerts SET notified_at = now()
     WHERE variant_id = NEW.id AND notified_at IS NULL
    RETURNING id, user_id)
  INSERT INTO outbox (event_type, payload)
  SELECT 'product.back_in_stock', jsonb_build_object(
    'alertId', id, 'userId', user_id, 'variantId', NEW.id, 'productId', NEW.product_id)
    FROM done;
  RETURN NEW;
END;
$$;
CREATE TRIGGER variants_back_in_stock AFTER UPDATE OF stock_on_hand, stock_reserved, status
  ON variants
  FOR EACH ROW WHEN (NEW.status = 'active' AND NEW.stock_on_hand > NEW.stock_reserved
    AND NOT (OLD.status = 'active' AND OLD.stock_on_hand > OLD.stock_reserved))
  EXECUTE FUNCTION notify_back_in_stock();

INSERT INTO notification_templates (event_type, locale, version, title, body) VALUES
  ('product.back_in_stock', 'en', 1, 'Back in stock: {product}',
   '{variant} is available again. Stock is only held once you check out.'),
  ('product.back_in_stock', 'ar', 1, 'عاد إلى المخزون: {product}',
   '{variant} متوفر مرة أخرى. لا يُحجز المخزون إلا عند إتمام الطلب.');
