-- Phase 4: branches with opening hours and closures, services with durations, buffers and a
-- cancellation policy, staff with branch and service assignments, weekly shifts and schedule
-- blocks (breaks, leave), and bookings: 10-minute holds, payment through the provider adapter,
-- confirmation on a verified webhook, check-in, completion, no-show, cancellation and reschedule.
-- Forward-only.
--
-- Invariants enforced here rather than only in code (docs/06-architecture-data.md):
--   * no two active bookings (held, confirmed, checked in) overlap for the same staff member,
--     buffers included: a btree_gist exclusion constraint on (staff_id, occupied range);
--   * every child row belongs to the same business as its parent (composite foreign keys), and a
--     shift can only be at a branch the staff member is assigned to;
--   * positive durations, prices and amounts; buffers and policy values within bounds;
--   * a held booking has an expiry; a customer booking has a customer and is prepaid.
-- Times are stored as UTC instants. Weekly hours and shifts are local wall-clock times in the
-- branch's timezone (Asia/Dubai by default, ADR-0005).

-- ---------------------------------------------------------------------------------------------
-- Memberships get the composite key staff rows point at.
ALTER TABLE memberships ADD CONSTRAINT memberships_id_business_id_key UNIQUE (id, business_id);

-- ---------------------------------------------------------------------------------------------
-- Branches (venues). Public when the business is approved, its services mode is active and the
-- branch is active.
CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  name jsonb NOT NULL CHECK (is_localized_text(name)),
  emirate_code text NOT NULL REFERENCES emirates (code),
  area text NOT NULL CHECK (length(area) BETWEEN 1 AND 120),
  street text NOT NULL CHECK (length(street) BETWEEN 1 AND 160),
  building text NOT NULL CHECK (length(building) BETWEEN 1 AND 120),
  latitude numeric(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  timezone text NOT NULL DEFAULT 'Asia/Dubai' CHECK (length(timezone) BETWEEN 3 AND 64),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);
CREATE INDEX branches_business_idx ON branches (business_id, created_at, id);
CREATE INDEX branches_emirate_idx ON branches (emirate_code);
CREATE TRIGGER branches_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Weekly opening hours, local time. Weekday 0 is Sunday. Several intervals per day are allowed
-- (a midday closure); intervals end on the same day (no overnight opening in the MVP).
CREATE TABLE branch_hours (
  branch_id uuid NOT NULL REFERENCES branches (id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  PRIMARY KEY (branch_id, weekday, opens_at),
  CHECK (closes_at > opens_at)
);

-- One-off closures (public holidays, maintenance). Instants, so they can span midnight.
CREATE TABLE branch_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 200),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX branch_closures_branch_idx ON branch_closures (branch_id, starts_at);
CREATE INDEX branch_closures_created_by_idx ON branch_closures (created_by);

-- ---------------------------------------------------------------------------------------------
-- Services. Fixed price (VAT-inclusive, ADR-0013), duration on a 5-minute grid, buffers before
-- and after, and the cancellation policy that bookings snapshot (D7: values are the merchant's).
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  mode text NOT NULL DEFAULT 'services' CHECK (mode = 'services'),
  category_id uuid NOT NULL,
  title jsonb NOT NULL CHECK (is_localized_text(title)),
  description jsonb NOT NULL CHECK (is_localized_text(description)),
  price_fils integer NOT NULL CHECK (price_fils > 0),
  tax_class text NOT NULL DEFAULT 'standard' CHECK (tax_class IN ('standard', 'zero_rated', 'exempt')),
  duration_min smallint NOT NULL CHECK (duration_min BETWEEN 5 AND 480 AND duration_min % 5 = 0),
  buffer_before_min smallint NOT NULL DEFAULT 0 CHECK (buffer_before_min BETWEEN 0 AND 120),
  buffer_after_min smallint NOT NULL DEFAULT 0 CHECK (buffer_after_min BETWEEN 0 AND 120),
  cancel_cutoff_hours smallint NOT NULL DEFAULT 24 CHECK (cancel_cutoff_hours BETWEEN 0 AND 168),
  late_cancel_refund_bps smallint NOT NULL DEFAULT 0 CHECK (late_cancel_refund_bps BETWEEN 0 AND 10000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  suspension_reason text CHECK (suspension_reason IS NULL OR length(suspension_reason) <= 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  FOREIGN KEY (category_id, mode) REFERENCES categories (id, mode),
  CHECK ((status = 'suspended') = (suspension_reason IS NOT NULL))
);
CREATE INDEX services_business_idx ON services (business_id, created_at, id);
CREATE INDEX services_category_idx ON services (category_id);
CREATE INDEX services_created_by_idx ON services (created_by);
CREATE TRIGGER services_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE branch_services (
  branch_id uuid NOT NULL,
  service_id uuid NOT NULL,
  business_id uuid NOT NULL,
  PRIMARY KEY (branch_id, service_id),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches (id, business_id),
  FOREIGN KEY (service_id, business_id) REFERENCES services (id, business_id)
);
CREATE INDEX branch_services_service_idx ON branch_services (service_id);
CREATE INDEX branch_services_business_idx ON branch_services (business_id);

-- ---------------------------------------------------------------------------------------------
-- Staff. Optionally linked to a member account (a professional who signs in to see their own
-- appointments); otherwise a bookable profile only.
CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  membership_id uuid,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  FOREIGN KEY (membership_id, business_id) REFERENCES memberships (id, business_id)
);
CREATE INDEX staff_business_idx ON staff (business_id, created_at, id);
CREATE UNIQUE INDEX staff_membership_key ON staff (membership_id) WHERE membership_id IS NOT NULL;
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE staff_branches (
  staff_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  PRIMARY KEY (staff_id, branch_id),
  FOREIGN KEY (staff_id, business_id) REFERENCES staff (id, business_id),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches (id, business_id)
);
CREATE INDEX staff_branches_branch_idx ON staff_branches (branch_id);
CREATE INDEX staff_branches_business_idx ON staff_branches (business_id);

CREATE TABLE staff_services (
  staff_id uuid NOT NULL,
  service_id uuid NOT NULL,
  business_id uuid NOT NULL,
  PRIMARY KEY (staff_id, service_id),
  FOREIGN KEY (staff_id, business_id) REFERENCES staff (id, business_id),
  FOREIGN KEY (service_id, business_id) REFERENCES services (id, business_id)
);
CREATE INDEX staff_services_service_idx ON staff_services (service_id);
CREATE INDEX staff_services_business_idx ON staff_services (business_id);

-- Weekly working hours at a branch, local time. Only at a branch the staff member is assigned to.
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES businesses (id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (staff_id, branch_id) REFERENCES staff_branches (staff_id, branch_id),
  FOREIGN KEY (staff_id, business_id) REFERENCES staff (id, business_id)
);
CREATE INDEX shifts_staff_idx ON shifts (staff_id, weekday);
CREATE INDEX shifts_branch_idx ON shifts (branch_id, weekday);
CREATE INDEX shifts_business_idx ON shifts (business_id);

-- Breaks, leave and other time a staff member cannot be booked.
CREATE TABLE schedule_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  business_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('break', 'leave', 'other')),
  reason text CHECK (reason IS NULL OR length(reason) <= 200),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (staff_id, business_id) REFERENCES staff (id, business_id)
);
CREATE INDEX schedule_blocks_staff_idx ON schedule_blocks (staff_id, starts_at);
CREATE INDEX schedule_blocks_business_idx ON schedule_blocks (business_id);
CREATE INDEX schedule_blocks_created_by_idx ON schedule_blocks (created_by);

-- ---------------------------------------------------------------------------------------------
-- Bookings. `occupied_*` is the staff member's busy interval: the appointment plus the service's
-- buffers. The exclusion constraint is what makes double booking impossible (T07).
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  branch_id uuid NOT NULL,
  service_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  occupied_start timestamptz NOT NULL,
  occupied_end timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN (
    'held', 'confirmed', 'checked_in', 'completed', 'canceled', 'no_show', 'expired')),
  hold_expires_at timestamptz,
  source text NOT NULL CHECK (source IN ('customer', 'manual')),
  payment_mode text NOT NULL CHECK (payment_mode IN ('prepaid', 'pay_at_venue')),
  price_fils integer NOT NULL CHECK (price_fils > 0),
  tax_fils integer NOT NULL CHECK (tax_fils >= 0 AND tax_fils <= price_fils),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  -- Service, staff and branch as booked (T13): later edits never change a booking.
  snapshot jsonb NOT NULL,
  -- Cancellation policy as accepted at booking time (docs/05-workflows.md).
  policy_snapshot jsonb NOT NULL,
  customer_name text CHECK (customer_name IS NULL OR length(customer_name) BETWEEN 1 AND 120),
  customer_phone text CHECK (customer_phone IS NULL OR customer_phone ~ '^\+[1-9][0-9]{6,14}$'),
  note text CHECK (note IS NULL OR length(note) <= 500),
  canceled_by text CHECK (canceled_by IS NULL OR canceled_by IN ('customer', 'business', 'system')),
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  refund_fils integer CHECK (refund_fils IS NULL OR refund_fils >= 0),
  created_by uuid REFERENCES users (id),
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  no_show_at timestamptz,
  expired_at timestamptz,
  rescheduled_count smallint NOT NULL DEFAULT 0 CHECK (rescheduled_count >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches (id, business_id),
  FOREIGN KEY (service_id, business_id) REFERENCES services (id, business_id),
  FOREIGN KEY (staff_id, business_id) REFERENCES staff (id, business_id),
  CHECK (end_at > start_at),
  CHECK (occupied_start <= start_at AND occupied_end >= end_at),
  CHECK (status <> 'held' OR hold_expires_at IS NOT NULL),
  CHECK (source <> 'customer' OR (user_id IS NOT NULL AND payment_mode = 'prepaid')),
  CHECK (source <> 'manual' OR customer_name IS NOT NULL),
  CHECK (refund_fils IS NULL OR refund_fils <= price_fils),
  CHECK ((status = 'canceled') = (canceled_at IS NOT NULL)),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(occupied_start, occupied_end, '[)') WITH &&
  ) WHERE (status IN ('held', 'confirmed', 'checked_in'))
);
CREATE INDEX bookings_user_idx ON bookings (user_id, start_at DESC, id);
CREATE INDEX bookings_business_idx ON bookings (business_id, start_at, id);
CREATE INDEX bookings_branch_idx ON bookings (branch_id, start_at);
CREATE INDEX bookings_service_idx ON bookings (service_id);
CREATE INDEX bookings_staff_idx ON bookings (staff_id, start_at);
CREATE INDEX bookings_created_by_idx ON bookings (created_by);
CREATE INDEX bookings_holds_idx ON bookings (hold_expires_at) WHERE status = 'held';
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Payments and refunds now cover bookings too. Booking payment is separate from orders.
ALTER TABLE payments DROP CONSTRAINT payments_target_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_target_type_check
  CHECK (target_type IN ('order', 'booking'));
ALTER TABLE payments ADD COLUMN booking_id uuid REFERENCES bookings (id);
ALTER TABLE payments ADD CONSTRAINT payments_target_check CHECK (
  (target_type = 'order' AND order_id IS NOT NULL AND booking_id IS NULL)
  OR (target_type = 'booking' AND booking_id IS NOT NULL AND order_id IS NULL));
CREATE UNIQUE INDEX payments_one_per_booking ON payments (booking_id) WHERE target_type = 'booking';
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN (
  'requires_payment', 'succeeded', 'failed', 'refund_pending', 'partially_refunded', 'refunded',
  'refund_failed'));

ALTER TABLE refunds DROP CONSTRAINT refunds_reason_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_check
  CHECK (reason IN ('late_payment', 'customer_cancellation', 'business_cancellation'));

-- ---------------------------------------------------------------------------------------------
-- Expires holds whose time is up, freeing the staff interval. Called by the worker and, inside
-- the same transaction, before any new hold is allocated (docs/06-architecture-data.md).
CREATE FUNCTION expire_booking_holds(p_now timestamptz, p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  b record;
  n integer := 0;
BEGIN
  FOR b IN
    SELECT id FROM bookings
     WHERE status = 'held' AND hold_expires_at <= p_now
     ORDER BY hold_expires_at, id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE bookings SET status = 'expired', expired_at = p_now, version = version + 1
     WHERE id = b.id;
    INSERT INTO outbox (event_type, payload, available_at)
      VALUES ('booking.expired', jsonb_build_object('bookingId', b.id), p_now);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
