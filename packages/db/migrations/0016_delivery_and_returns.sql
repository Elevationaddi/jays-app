-- Phase 8.8 (part 3): delivery methods, return policies and an optional delivery partner (ADR-0029).
--
--   1. Delivery methods. A business's delivery zone is now per emirate and method (standard or
--      express), so it can offer a faster option at a different fee. The customer picks one per
--      seller at checkout; the order keeps the method in its delivery snapshot.
--   2. Return policies. A business sets its return window (never shorter than the platform's
--      14 days until a lawyer confirms the statutory minimum) and an optional note. Admins can
--      mark a category non-returnable (for example opened hygiene products). Both are copied
--      onto each order when it is placed, so later changes never affect an order. A customer can
--      still report a non-returnable item as faulty.
--   3. Delivery partner. A shipment records whether a delivery-partner adapter booked it. There
--      is no paid provider: only manual tracking and a mock that production refuses.

-- 1. Delivery methods.
ALTER TABLE delivery_zones ADD COLUMN method text NOT NULL DEFAULT 'standard'
  CHECK (method IN ('standard', 'express'));
ALTER TABLE delivery_zones DROP CONSTRAINT delivery_zones_business_id_emirate_code_key;
ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_business_emirate_method_key
  UNIQUE (business_id, emirate_code, method);

-- 2. Return policies.
ALTER TABLE businesses ADD COLUMN return_window_days smallint NOT NULL DEFAULT 14
  CHECK (return_window_days BETWEEN 14 AND 90);
ALTER TABLE businesses ADD COLUMN return_policy_note jsonb CHECK (
  return_policy_note IS NULL OR (
    jsonb_typeof(return_policy_note) = 'object'
    AND length(coalesce(return_policy_note ->> 'en', '')) <= 500
    AND length(coalesce(return_policy_note ->> 'ar', '')) <= 500));
ALTER TABLE categories ADD COLUMN returnable boolean NOT NULL DEFAULT true;
-- NULL on orders placed before this change: the platform default (14 days) applies.
ALTER TABLE merchant_orders ADD COLUMN return_window_days smallint
  CHECK (return_window_days IS NULL OR return_window_days BETWEEN 14 AND 90);
ALTER TABLE order_items ADD COLUMN returnable boolean NOT NULL DEFAULT true;
ALTER TABLE return_requests ADD COLUMN faulty boolean NOT NULL DEFAULT false;

-- 3. Delivery partner.
ALTER TABLE merchant_orders ADD COLUMN delivery_partner text
  CHECK (delivery_partner IS NULL OR delivery_partner IN ('mock'));
