-- Phase 8.8 (part 1): booking policies (ADR-0025, ADR-0027).
--
--   1. A configurable no-show refund share per service, snapshotted on each booking like the
--      cancellation policy (D7).
--   2. Travel status for home visits (not_started, on_the_way, arrived), with an append-only
--      record of who changed it and when. The travel fee is refunded in full when the customer
--      cancels before travel starts.
--   3. Non-commissionable amounts: an earning records the part of its gross that carries no
--      commission (a booking's travel fee, an order's delivery charge, VAT included), and a
--      refund records the part of itself taken from it, so a travel-fee refund reverses no
--      commission.

-- 1. No-show refund share.
ALTER TABLE services ADD COLUMN no_show_refund_bps smallint NOT NULL DEFAULT 0
  CHECK (no_show_refund_bps BETWEEN 0 AND 10000);

-- 2. Travel status.
ALTER TABLE bookings ADD COLUMN travel_status text
  CHECK (travel_status IS NULL OR travel_status IN ('not_started', 'on_the_way', 'arrived'));
UPDATE bookings SET travel_status = 'not_started' WHERE location_type = 'home';
ALTER TABLE bookings ADD CONSTRAINT bookings_travel_status_home
  CHECK ((location_type = 'home') = (travel_status IS NOT NULL));

-- New home bookings start at not_started without every insert having to say so.
CREATE FUNCTION bookings_default_travel_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.location_type = 'home' AND NEW.travel_status IS NULL THEN
    NEW.travel_status := 'not_started';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bookings_default_travel_status BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_default_travel_status();

CREATE TABLE booking_travel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  status text NOT NULL CHECK (status IN ('on_the_way', 'arrived')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, status)
);
CREATE INDEX booking_travel_events_business_idx ON booking_travel_events (business_id);
CREATE TRIGGER booking_travel_events_no_update BEFORE UPDATE OR DELETE ON booking_travel_events
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- 3. Non-commissionable amounts.
ALTER TABLE merchant_earnings ADD COLUMN non_commissionable_fils integer NOT NULL DEFAULT 0;
ALTER TABLE merchant_earnings ADD COLUMN non_commissionable_refunded_fils integer NOT NULL
  DEFAULT 0;
-- Earnings captured before ADR-0025 charged commission on the travel fee; capping at the part of
-- the gross outside the commission base keeps their refunds returning that commission.
UPDATE merchant_earnings e
  SET non_commissionable_fils = LEAST(b.travel_fee_fils, e.gross_fils - e.commission_base_fils)
  FROM bookings b WHERE b.id = e.booking_id;
UPDATE merchant_earnings e
  SET non_commissionable_fils = LEAST(mo.delivery_fils, e.gross_fils - e.commission_base_fils)
  FROM merchant_orders mo WHERE mo.id = e.merchant_order_id;
ALTER TABLE merchant_earnings ADD CONSTRAINT merchant_earnings_non_commissionable
  CHECK (non_commissionable_fils BETWEEN 0 AND gross_fils - commission_base_fils
    AND non_commissionable_refunded_fils BETWEEN 0 AND non_commissionable_fils
    AND non_commissionable_refunded_fils <= refunded_fils);

ALTER TABLE refunds DROP CONSTRAINT refunds_reason_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_check CHECK (reason IN (
  'late_payment', 'customer_cancellation', 'business_cancellation', 'no_show', 'admin', 'return'));
-- NULL: the caller did not say (an admin refund of an amount); the earning's own mix applies.
ALTER TABLE refunds ADD COLUMN non_commissionable_fils integer;
ALTER TABLE refunds ADD CONSTRAINT refunds_non_commissionable
  CHECK (non_commissionable_fils IS NULL OR non_commissionable_fils BETWEEN 0 AND amount_fils);

-- 4. The customer hears that the professional is on the way.
INSERT INTO notification_templates (event_type, locale, version, title, body) VALUES
  ('booking.travel_started', 'en', 1, '{staff} is on the way',
   'Your professional from {business} has set off for your appointment {when}.'),
  ('booking.travel_started', 'ar', 1, '{staff} في الطريق إليك',
   'انطلق المختص من {business} إلى موعدك {when}.');
