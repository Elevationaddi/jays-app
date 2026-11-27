-- Phase 3: product catalog with variants and SKUs, admin listing approval, transactional
-- inventory, merchant delivery zones, carts, server-priced expiring quotes, multi-seller orders
-- with merchant suborders, stock reservations, payments through a provider adapter (mock only
-- until phase 5), verified webhook events and idempotency keys. Forward-only.
--
-- Invariants enforced here rather than only in code (docs/06-architecture-data.md):
--   * stock_on_hand >= stock_reserved >= 0 on every variant (no oversell, no negative stock);
--   * SKU unique per business; positive prices; quantities > 0; amounts non-negative;
--   * every child row belongs to the same business as its parent (composite foreign keys);
--   * order totals add up (CHECKs) and each order points at exactly one quote;
--   * stock movements and webhook events are append-only.
-- Locking rule used by the API, the worker and the functions below: lock an order row before any
-- variant rows, and lock variant rows in ascending id order. That single order prevents deadlocks.

-- ---------------------------------------------------------------------------------------------
-- Product images reuse the validated media pipeline from phase 2.
ALTER TABLE media DROP CONSTRAINT media_purpose_check;
ALTER TABLE media ADD CONSTRAINT media_purpose_check
  CHECK (purpose IN ('storefront_logo', 'storefront_banner', 'product_image'));

-- ---------------------------------------------------------------------------------------------
-- Tax rates per tax class, effective-dated. VAT treatment is founder decision D4 (ADR-0007):
-- these seeded rates are a proposed default, prices are entered VAT-inclusive and the tax
-- portion is extracted (ADR-0013).
CREATE TABLE tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_class text NOT NULL CHECK (tax_class IN ('standard', 'zero_rated', 'exempt')),
  rate_bps integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_class, effective_at)
);
INSERT INTO tax_rates (tax_class, rate_bps, effective_at) VALUES
  ('standard', 500, '2018-01-01T00:00:00Z'),
  ('zero_rated', 0, '2018-01-01T00:00:00Z'),
  ('exempt', 0, '2018-01-01T00:00:00Z');

-- ---------------------------------------------------------------------------------------------
-- Products. Like storefronts, the merchant edits the draft columns and customers only ever see
-- the live_* copy, written when an admin approves. After approval, content edits wait for review
-- (changes_submitted_at) while the previous live version stays public.
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  mode text NOT NULL DEFAULT 'shop' CHECK (mode = 'shop'),
  category_id uuid NOT NULL,
  brand_id uuid REFERENCES brands (id),
  title jsonb NOT NULL CHECK (is_localized_text(title)),
  description jsonb NOT NULL CHECK (is_localized_text(description)),
  details jsonb CHECK (details IS NULL OR is_localized_text(details)),
  return_eligible boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'active', 'rejected', 'suspended', 'archived')),
  live_title jsonb CHECK (live_title IS NULL OR is_localized_text(live_title)),
  live_description jsonb CHECK (live_description IS NULL OR is_localized_text(live_description)),
  live_details jsonb CHECK (live_details IS NULL OR is_localized_text(live_details)),
  live_category_id uuid,
  live_brand_id uuid REFERENCES brands (id),
  live_return_eligible boolean,
  live_media_ids uuid[] NOT NULL DEFAULT '{}',
  published_at timestamptz,
  submitted_at timestamptz,
  changes_submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES admin_accounts (id),
  review_reason text CHECK (review_reason IS NULL OR length(review_reason) <= 1000),
  suspension_reason text CHECK (suspension_reason IS NULL OR length(suspension_reason) <= 1000),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  FOREIGN KEY (category_id, mode) REFERENCES categories (id, mode),
  FOREIGN KEY (live_category_id, mode) REFERENCES categories (id, mode),
  CHECK ((published_at IS NULL) = (live_title IS NULL)),
  CHECK (live_title IS NULL OR (live_description IS NOT NULL AND live_category_id IS NOT NULL
                                AND live_return_eligible IS NOT NULL)),
  CHECK (status NOT IN ('active', 'suspended') OR published_at IS NOT NULL),
  CHECK (status <> 'rejected' OR review_reason IS NOT NULL),
  CHECK ((status = 'suspended') = (suspension_reason IS NOT NULL)),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  CHECK (status <> 'submitted' OR submitted_at IS NOT NULL)
);
CREATE INDEX products_business_idx ON products (business_id, created_at, id);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_live_category_idx ON products (live_category_id);
CREATE INDEX products_brand_idx ON products (brand_id);
CREATE INDEX products_live_brand_idx ON products (live_brand_id);
CREATE INDEX products_reviewed_by_idx ON products (reviewed_by);
CREATE INDEX products_created_by_idx ON products (created_by);
CREATE INDEX products_public_idx ON products (published_at, id) WHERE status = 'active';
CREATE INDEX products_review_queue_idx ON products (submitted_at, id) WHERE status = 'submitted';
CREATE INDEX products_changes_idx ON products (changes_submitted_at)
  WHERE changes_submitted_at IS NOT NULL;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Draft image order. The live order is products.live_media_ids, copied on approval.
CREATE TABLE product_media (
  product_id uuid NOT NULL,
  business_id uuid NOT NULL,
  media_id uuid NOT NULL,
  sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, media_id),
  UNIQUE (product_id, sort_order),
  FOREIGN KEY (product_id, business_id) REFERENCES products (id, business_id),
  FOREIGN KEY (media_id, business_id) REFERENCES media (id, business_id)
);
CREATE INDEX product_media_media_idx ON product_media (media_id);
CREATE INDEX product_media_business_idx ON product_media (business_id);

-- Variants carry the SKU, price and stock. Price and stock changes are operational and apply at
-- once; they never change an existing order (order_items snapshot them, T13).
CREATE TABLE variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  business_id uuid NOT NULL,
  sku text NOT NULL CHECK (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  name jsonb NOT NULL CHECK (is_localized_text(name)),
  barcode text CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$'),
  price_fils integer NOT NULL CHECK (price_fils > 0),
  tax_class text NOT NULL DEFAULT 'standard' CHECK (tax_class IN ('standard', 'zero_rated', 'exempt')),
  stock_on_hand integer NOT NULL DEFAULT 0,
  stock_reserved integer NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold BETWEEN 0 AND 100000),
  weight_grams integer CHECK (weight_grams IS NULL OR weight_grams BETWEEN 1 AND 100000),
  sort_order smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sku),
  UNIQUE (id, business_id),
  FOREIGN KEY (product_id, business_id) REFERENCES products (id, business_id),
  CONSTRAINT variants_stock_reserved_check CHECK (stock_reserved >= 0),
  CONSTRAINT variants_stock_on_hand_check CHECK (stock_on_hand >= stock_reserved)
);
CREATE INDEX variants_product_idx ON variants (product_id, sort_order, id);
CREATE TRIGGER variants_updated_at BEFORE UPDATE ON variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every change to stock on hand, with its reason and actor. Reserved stock is tracked by
-- reservations. Append-only.
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (reason IN (
    'initial_stock', 'restock', 'damaged', 'lost', 'correction', 'return_restock', 'sale')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  order_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_id uuid,
  on_hand_after integer NOT NULL CHECK (on_hand_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, business_id) REFERENCES variants (id, business_id),
  CHECK (actor_type = 'system' OR actor_id IS NOT NULL),
  CHECK ((reason = 'sale') = (order_id IS NOT NULL)),
  CHECK (reason <> 'sale' OR delta < 0)
);
CREATE INDEX stock_movements_variant_idx ON stock_movements (variant_id, created_at, id);
CREATE INDEX stock_movements_business_idx ON stock_movements (business_id);
CREATE INDEX stock_movements_order_idx ON stock_movements (order_id);

CREATE FUNCTION append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- ---------------------------------------------------------------------------------------------
-- Merchant delivery zones (ADR-0007 D8: merchant-arranged delivery with merchant-defined zones and
-- fees). One zone per emirate per business. Checkout refuses addresses outside every zone.
CREATE TABLE delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  emirate_code text NOT NULL REFERENCES emirates (code),
  fee_fils integer NOT NULL CHECK (fee_fils BETWEEN 0 AND 100000000),
  free_over_fils integer CHECK (free_over_fils IS NULL OR free_over_fils > 0),
  min_days smallint NOT NULL CHECK (min_days BETWEEN 0 AND 30),
  max_days smallint NOT NULL CHECK (max_days BETWEEN 0 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, emirate_code),
  CHECK (max_days >= min_days)
);
CREATE INDEX delivery_zones_emirate_idx ON delivery_zones (emirate_code);
CREATE TRIGGER delivery_zones_updated_at BEFORE UPDATE ON delivery_zones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Carts. A guest cart is found by the hash of an opaque token the app keeps; signing in merges it
-- into the account's single active cart (T01). Switching mode never touches the cart.
CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users (id),
  guest_token_hash text UNIQUE CHECK (guest_token_hash IS NULL OR guest_token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged')),
  merged_into uuid REFERENCES carts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (guest_token_hash IS NULL)),
  CHECK ((status = 'merged') = (merged_into IS NOT NULL))
);
CREATE UNIQUE INDEX carts_one_active_per_user ON carts (user_id) WHERE status = 'active';
CREATE INDEX carts_merged_into_idx ON carts (merged_into);
CREATE TRIGGER carts_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts (id),
  variant_id uuid NOT NULL REFERENCES variants (id),
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 99),
  -- Price when last added or changed, so the cart can flag a price change (docs/02-customer.md).
  price_seen_fils integer NOT NULL CHECK (price_seen_fils > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);
CREATE INDEX cart_items_variant_idx ON cart_items (variant_id);
CREATE TRIGGER cart_items_updated_at BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Quotes: the server-priced, expiring basis of an order. Clients never send totals.
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  cart_id uuid NOT NULL REFERENCES carts (id),
  address_id uuid NOT NULL REFERENCES addresses (id),
  address_snapshot jsonb NOT NULL,
  -- Per-merchant groups with their lines, exactly as priced.
  breakdown jsonb NOT NULL,
  subtotal_fils integer NOT NULL CHECK (subtotal_fils > 0),
  delivery_fils integer NOT NULL CHECK (delivery_fils >= 0),
  discount_fils integer NOT NULL DEFAULT 0 CHECK (discount_fils >= 0),
  tax_fils integer NOT NULL CHECK (tax_fils >= 0),
  total_fils integer NOT NULL CHECK (total_fils > 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_fils = subtotal_fils + delivery_fils - discount_fils),
  CHECK (tax_fils <= total_fils)
);
CREATE INDEX quotes_user_idx ON quotes (user_id, created_at);
CREATE INDEX quotes_cart_idx ON quotes (cart_id);
CREATE INDEX quotes_address_idx ON quotes (address_id);

-- ---------------------------------------------------------------------------------------------
-- Orders and merchant suborders. orders.status is the payment state (docs/05-workflows.md):
-- pending_payment -> paid | failed | expired; paid -> partially_refunded | refunded (phase 5).
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  quote_id uuid NOT NULL UNIQUE REFERENCES quotes (id),
  cart_id uuid NOT NULL REFERENCES carts (id),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded')),
  subtotal_fils integer NOT NULL CHECK (subtotal_fils > 0),
  delivery_fils integer NOT NULL CHECK (delivery_fils >= 0),
  discount_fils integer NOT NULL DEFAULT 0 CHECK (discount_fils >= 0),
  tax_fils integer NOT NULL CHECK (tax_fils >= 0),
  total_fils integer NOT NULL CHECK (total_fils > 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  address_snapshot jsonb NOT NULL,
  payment_expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_fils = subtotal_fils + delivery_fils - discount_fils),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL),
  CHECK (status <> 'expired' OR expired_at IS NOT NULL)
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at, id);
CREATE INDEX orders_cart_idx ON orders (cart_id);
CREATE INDEX orders_pending_expiry_idx ON orders (payment_expires_at, id) WHERE status = 'pending_payment';
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Fulfillment state per merchant: pending_payment -> paid -> processing -> shipped -> delivered,
-- or canceled (payment failed or expired, or an eligible cancellation in phase 6).
CREATE TABLE merchant_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'canceled')),
  cancel_reason text CHECK (cancel_reason IS NULL OR cancel_reason IN (
    'payment_failed', 'payment_expired', 'customer_request', 'merchant_request')),
  subtotal_fils integer NOT NULL CHECK (subtotal_fils > 0),
  delivery_fils integer NOT NULL CHECK (delivery_fils >= 0),
  discount_fils integer NOT NULL DEFAULT 0 CHECK (discount_fils >= 0),
  tax_fils integer NOT NULL CHECK (tax_fils >= 0),
  total_fils integer NOT NULL CHECK (total_fils > 0),
  delivery_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, business_id),
  UNIQUE (id, business_id),
  CHECK (total_fils = subtotal_fils + delivery_fils - discount_fils),
  CHECK ((status = 'canceled') = (cancel_reason IS NOT NULL))
);
CREATE INDEX merchant_orders_business_idx ON merchant_orders (business_id, created_at, id);
CREATE TRIGGER merchant_orders_updated_at BEFORE UPDATE ON merchant_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lines snapshot everything the customer agreed to, so later price, title or policy changes never
-- rewrite history (T13).
CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id),
  merchant_order_id uuid NOT NULL,
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price_fils integer NOT NULL CHECK (unit_price_fils > 0),
  line_total_fils integer NOT NULL CHECK (line_total_fils > 0),
  discount_fils integer NOT NULL DEFAULT 0 CHECK (discount_fils >= 0),
  tax_class text NOT NULL CHECK (tax_class IN ('standard', 'zero_rated', 'exempt')),
  tax_rate_bps integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_fils integer NOT NULL CHECK (tax_fils >= 0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_order_id, business_id) REFERENCES merchant_orders (id, business_id),
  FOREIGN KEY (variant_id, business_id) REFERENCES variants (id, business_id),
  FOREIGN KEY (product_id, business_id) REFERENCES products (id, business_id),
  UNIQUE (merchant_order_id, variant_id),
  CHECK (line_total_fils = unit_price_fils * qty),
  CHECK (tax_fils <= line_total_fils)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_variant_idx ON order_items (variant_id);
CREATE INDEX order_items_product_idx ON order_items (product_id);

-- Stock held for an unpaid order until its payment window ends.
CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id),
  variant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'released')),
  released_reason text CHECK (released_reason IS NULL OR released_reason IN ('payment_failed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, business_id) REFERENCES variants (id, business_id),
  UNIQUE (order_id, variant_id),
  CHECK ((status = 'released') = (released_reason IS NOT NULL))
);
CREATE INDEX reservations_variant_idx ON reservations (variant_id);
CREATE INDEX reservations_active_expiry_idx ON reservations (expires_at) WHERE status = 'active';
CREATE TRIGGER reservations_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Payments through the provider adapter. Only a verified webhook moves a payment to succeeded or
-- failed (ADR-0006); a client redirect never confirms payment. Bookings join in phase 4.
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('order')),
  order_id uuid REFERENCES orders (id),
  provider text NOT NULL CHECK (provider IN ('mock')),
  provider_intent_id text UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  amount_fils integer NOT NULL CHECK (amount_fils > 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  status text NOT NULL DEFAULT 'requires_payment' CHECK (status IN (
    'requires_payment', 'succeeded', 'failed', 'refund_pending', 'refunded', 'refund_failed')),
  -- Client-scoped token for the provider's hosted payment UI. Not a server secret.
  client_secret text,
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) <= 100),
  -- Set when a late payment could not be refunded automatically: operations must act.
  needs_attention boolean NOT NULL DEFAULT false,
  succeeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_type <> 'order' OR order_id IS NOT NULL),
  CHECK ((provider_intent_id IS NULL) = (client_secret IS NULL)),
  CHECK (status NOT IN ('succeeded', 'refund_pending', 'refunded', 'refund_failed') OR succeeded_at IS NOT NULL)
);
CREATE UNIQUE INDEX payments_one_per_order ON payments (order_id) WHERE target_type = 'order';
CREATE INDEX payments_attention_idx ON payments (created_at) WHERE needs_attention;
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refunds. Phase 3 only issues automatic refunds for payments that arrive after their order
-- expired or failed; partial and customer refunds arrive in phase 5.
CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments (id),
  amount_fils integer NOT NULL CHECK (amount_fils > 0),
  reason text NOT NULL CHECK (reason IN ('late_payment')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider_ref text UNIQUE,
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Verified provider events, recorded once. A replayed event id is a no-op (T06).
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('mock')),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL DEFAULT 'received' CHECK (length(outcome) BETWEEN 1 AND 100),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
-- Only the processing outcome may be written after the event is recorded; nothing is deleted.
CREATE FUNCTION webhook_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.id <> OLD.id OR NEW.provider <> OLD.provider
     OR NEW.event_id <> OLD.event_id OR NEW.event_type <> OLD.event_type
     OR NEW.payload_hash <> OLD.payload_hash OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'webhook_events only allows recording an outcome' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER webhook_events_guard BEFORE UPDATE OR DELETE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION webhook_events_guard();

-- Idempotency keys (docs/07-api.md): scoped to actor and route, the request is hashed, an
-- identical retry gets the stored response and a changed request with the same key gets 409.
CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin')),
  actor_id uuid NOT NULL,
  route text NOT NULL CHECK (length(route) BETWEEN 1 AND 200),
  key text NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_status integer CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 299),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_type, actor_id, route, key),
  CHECK ((status = 'completed') = (response_status IS NOT NULL))
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
CREATE TRIGGER idempotency_keys_updated_at BEFORE UPDATE ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Releasing reserved stock. Shared by the API (payment failed, and before reserving so stale
-- holds never block a sale) and the worker (payment window ended), so the rule lives in one place.

-- Releases an order's active reservations. The caller must hold the order row lock.
CREATE FUNCTION release_order_reservations(p_order_id uuid, p_reason text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  released integer;
BEGIN
  -- Variant locks in ascending id order (see the locking rule at the top of this file).
  PERFORM 1 FROM variants
    WHERE id IN (SELECT variant_id FROM reservations WHERE order_id = p_order_id AND status = 'active')
    ORDER BY id FOR UPDATE;
  UPDATE variants v SET stock_reserved = v.stock_reserved - r.qty
    FROM reservations r
   WHERE r.order_id = p_order_id AND r.status = 'active' AND v.id = r.variant_id;
  UPDATE reservations SET status = 'released', released_reason = p_reason
   WHERE order_id = p_order_id AND status = 'active';
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

-- Expires unpaid orders whose payment window has ended: releases stock, cancels the suborders
-- and queues an event. Rows another transaction is working on are skipped and retried later.
CREATE FUNCTION expire_unpaid_orders(p_now timestamptz, p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  o record;
  n integer := 0;
BEGIN
  FOR o IN
    SELECT id FROM orders
     WHERE status = 'pending_payment' AND payment_expires_at <= p_now
     ORDER BY payment_expires_at, id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM release_order_reservations(o.id, 'expired');
    UPDATE orders SET status = 'expired', expired_at = p_now WHERE id = o.id;
    UPDATE merchant_orders SET status = 'canceled', cancel_reason = 'payment_expired'
     WHERE order_id = o.id AND status = 'pending_payment';
    INSERT INTO outbox (event_type, payload, available_at)
      VALUES ('order.expired', jsonb_build_object('orderId', o.id), p_now);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
