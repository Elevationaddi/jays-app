-- Phase 12: pilot promotion (ADR-0025, ADR-0034).
--
-- Approved pilot merchants pay 0% platform commission for their first 30 days. One promotion
-- per business, recorded by a finance admin with the founder's approval reference. The commission
-- engine applies it at capture time; afterwards the normal fee rules (default 10%, or a category
-- rate) apply again with nothing to undo. Cancelling ends the promotion at that moment and never
-- changes earlier earnings, which keep the rate in force at capture.
CREATE TABLE pilot_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES businesses (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  founder_approval text NOT NULL CHECK (length(founder_approval) BETWEEN 5 AND 500),
  created_by uuid NOT NULL REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES admin_accounts (id),
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 3 AND 500),
  notified_7d_at timestamptz,
  notified_1d_at timestamptz,
  CHECK (ends_at > starts_at),
  CHECK (ends_at <= starts_at + interval '31 days'),
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL))
);
CREATE INDEX pilot_promotions_ending_idx ON pilot_promotions (ends_at) WHERE cancelled_at IS NULL;

-- Which promotion, if any, set an earning's commission to zero.
ALTER TABLE merchant_earnings ADD COLUMN pilot_promotion_id uuid REFERENCES pilot_promotions (id);

INSERT INTO notification_templates (event_type, locale, version, title, body) VALUES
  ('pilot.promotion_ending', 'en', 1, 'Your 0% commission ends {when}',
   'Your pilot offer of 0% commission ends {when}. After that, the standard commission ({rate}) applies to new sales. Earlier sales are not affected.'),
  ('pilot.promotion_ending', 'ar', 1, 'تنتهي عمولة 0% {when}',
   'ينتهي عرض المرحلة التجريبية بعمولة 0% {when}. بعد ذلك تُطبَّق العمولة المعتادة ({rate}) على المبيعات الجديدة. لا تتأثر المبيعات السابقة.')
ON CONFLICT DO NOTHING;
