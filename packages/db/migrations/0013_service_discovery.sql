-- Phase 8.7: service discovery, add-ons, appointment reminders, waitlist, professional profiles
-- and portfolios (ADR-0026).

-- ---------------------------------------------------------------------------------------------
-- Add-ons: optional extras for one service, performed by the same professional in the same visit.
-- The price is VAT-inclusive like the service's and takes the service's VAT treatment; the
-- extra minutes lengthen the appointment. Bookings snapshot the add-ons they include.
CREATE TABLE service_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  service_id uuid NOT NULL,
  title jsonb NOT NULL CHECK (is_localized_text(title)),
  price_fils integer NOT NULL CHECK (price_fils BETWEEN 0 AND 10000000),
  duration_min smallint NOT NULL CHECK (duration_min BETWEEN 0 AND 240 AND duration_min % 5 = 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 99),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  FOREIGN KEY (service_id, business_id) REFERENCES services (id, business_id)
);
CREATE INDEX service_addons_service_idx ON service_addons (service_id, sort_order, created_at);
CREATE INDEX service_addons_business_idx ON service_addons (business_id);
CREATE INDEX service_addons_created_by_idx ON service_addons (created_by);
CREATE TRIGGER service_addons_updated_at BEFORE UPDATE ON service_addons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What a booking includes, as booked. `addons_fils` is part of `price_fils`, like the travel fee,
-- so the service's own price is price_fils - addons_fils - travel_fee_fils.
ALTER TABLE bookings ADD COLUMN addons jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(addons) = 'array' AND jsonb_array_length(addons) <= 10);
ALTER TABLE bookings ADD COLUMN addons_fils integer NOT NULL DEFAULT 0 CHECK (addons_fils >= 0);
ALTER TABLE bookings ADD CONSTRAINT bookings_extras_within_price
  CHECK (addons_fils + travel_fee_fils < price_fils);

-- ---------------------------------------------------------------------------------------------
-- Professional profiles: a short bilingual bio shown to customers.
ALTER TABLE staff ADD COLUMN bio jsonb CHECK (bio IS NULL OR is_localized_text(bio));

-- ---------------------------------------------------------------------------------------------
-- Portfolios: photos of past work, for a service, a professional, or the business generally.
-- Images go through the same upload checks as product images (files.ts, purpose portfolio_image).
ALTER TABLE media DROP CONSTRAINT media_purpose_check;
ALTER TABLE media ADD CONSTRAINT media_purpose_check
  CHECK (purpose IN ('storefront_logo', 'storefront_banner', 'product_image', 'portfolio_image'));

CREATE TABLE portfolio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  media_id uuid NOT NULL,
  service_id uuid,
  staff_id uuid,
  caption jsonb CHECK (caption IS NULL OR is_localized_text(caption)),
  sort_order smallint NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 99),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id),
  FOREIGN KEY (media_id, business_id) REFERENCES media (id, business_id),
  FOREIGN KEY (service_id, business_id) REFERENCES services (id, business_id),
  FOREIGN KEY (staff_id, business_id) REFERENCES staff (id, business_id)
);
CREATE INDEX portfolio_items_business_idx ON portfolio_items (business_id, sort_order, created_at);
CREATE INDEX portfolio_items_service_idx ON portfolio_items (service_id) WHERE service_id IS NOT NULL;
CREATE INDEX portfolio_items_staff_idx ON portfolio_items (staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX portfolio_items_created_by_idx ON portfolio_items (created_by);

-- ---------------------------------------------------------------------------------------------
-- Appointment reminders: one per confirmed booking, sent about a day before. A booking made
-- shortly before its start needs no reminder.
ALTER TABLE bookings ADD COLUMN reminder_sent_at timestamptz;
CREATE INDEX bookings_reminder_due_idx ON bookings (start_at)
  WHERE status = 'confirmed' AND reminder_sent_at IS NULL;

CREATE FUNCTION queue_booking_reminders(
  p_now timestamptz,
  p_lead_hours integer DEFAULT 24,
  p_limit integer DEFAULT 200
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  b record;
  n integer := 0;
BEGIN
  FOR b IN
    SELECT id FROM bookings
     WHERE status = 'confirmed'
       AND reminder_sent_at IS NULL
       AND start_at > p_now
       AND start_at <= p_now + make_interval(hours => p_lead_hours)
       AND coalesce(confirmed_at, created_at) < start_at - interval '2 hours'
     ORDER BY start_at, id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE bookings SET reminder_sent_at = p_now WHERE id = b.id;
    INSERT INTO outbox (event_type, payload, available_at)
      VALUES ('booking.reminder', jsonb_build_object('bookingId', b.id), p_now);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Waitlist: a customer asks to hear when a time opens for a service at a branch on a date,
-- optionally with one professional and within a time window (branch local time). Joining
-- reserves nothing: when an appointment that matches is canceled or its hold expires, everyone
-- waiting for it is told once, and the first to book gets the time (the exclusion constraint
-- decides, as for any booking).
CREATE TABLE booking_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  branch_id uuid NOT NULL,
  service_id uuid NOT NULL,
  staff_id uuid,
  date date NOT NULL,
  window_start time NOT NULL DEFAULT '00:00',
  window_end time NOT NULL DEFAULT '23:59',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'notified', 'canceled', 'expired')),
  notified_booking_id uuid REFERENCES bookings (id),
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end > window_start),
  CHECK (status <> 'notified' OR notified_at IS NOT NULL),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches (id, business_id),
  FOREIGN KEY (service_id, business_id) REFERENCES services (id, business_id),
  FOREIGN KEY (staff_id, business_id) REFERENCES staff (id, business_id)
);
CREATE UNIQUE INDEX booking_waitlist_one_active ON booking_waitlist
  (user_id, branch_id, service_id, date) WHERE status = 'active';
CREATE INDEX booking_waitlist_match_idx ON booking_waitlist (branch_id, service_id, date)
  WHERE status = 'active';
CREATE INDEX booking_waitlist_user_idx ON booking_waitlist (user_id, created_at DESC);
CREATE INDEX booking_waitlist_business_idx ON booking_waitlist (business_id);
CREATE INDEX booking_waitlist_staff_idx ON booking_waitlist (staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX booking_waitlist_booking_idx ON booking_waitlist (notified_booking_id);
CREATE TRIGGER booking_waitlist_updated_at BEFORE UPDATE ON booking_waitlist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- When an active appointment is canceled or its hold expires, its time is free again: tell the
-- customers waiting for that service, branch and local date whose window covers the start.
CREATE FUNCTION notify_waitlist_on_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tz text;
  local_start timestamp;
  w record;
BEGIN
  SELECT timezone INTO tz FROM branches WHERE id = NEW.branch_id;
  local_start := NEW.start_at AT TIME ZONE tz;
  FOR w IN
    SELECT id, user_id FROM booking_waitlist
     WHERE status = 'active'
       AND branch_id = NEW.branch_id
       AND service_id = NEW.service_id
       AND date = local_start::date
       AND window_start <= local_start::time
       AND window_end > local_start::time
       AND (staff_id IS NULL OR staff_id = NEW.staff_id)
       AND user_id IS DISTINCT FROM NEW.user_id
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE booking_waitlist
       SET status = 'notified', notified_at = now(), notified_booking_id = NEW.id
     WHERE id = w.id;
    INSERT INTO outbox (event_type, payload)
      VALUES ('booking.waitlist_opened',
              jsonb_build_object('waitlistId', w.id, 'userId', w.user_id, 'startAt', NEW.start_at));
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bookings_release_waitlist AFTER UPDATE OF status ON bookings
  FOR EACH ROW
  WHEN (OLD.status IN ('held', 'confirmed', 'checked_in') AND NEW.status IN ('canceled', 'expired')
        AND NEW.start_at > now())
  EXECUTE FUNCTION notify_waitlist_on_release();

-- Entries for a day that has passed expire (run with the reminders job).
CREATE FUNCTION expire_waitlist_entries(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  UPDATE booking_waitlist w SET status = 'expired'
    FROM branches b
   WHERE b.id = w.branch_id
     AND w.status = 'active'
     AND w.date < (p_now AT TIME ZONE b.timezone)::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- A deleted account stops waiting (ADR-0019).
CREATE FUNCTION scrub_deleted_user_waitlist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE booking_waitlist SET status = 'canceled' WHERE user_id = NEW.id AND status = 'active';
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_deleted_scrub_waitlist AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION scrub_deleted_user_waitlist();

-- ---------------------------------------------------------------------------------------------
-- Discovery: services by category and price, and published booking reviews by service and staff.
CREATE INDEX services_discovery_idx ON services (category_id, price_fils) WHERE status = 'active';
CREATE INDEX reviews_service_idx ON reviews (service_id) WHERE status = 'published';

INSERT INTO notification_templates (event_type, locale, version, title, body) VALUES
  ('booking.reminder', 'en', 1, 'Reminder: {business} {when}',
   'Your appointment {ref} is coming up. If you can''t make it, cancel or move it from the app.'),
  ('booking.reminder', 'ar', 1, 'تذكير: {business} {when}',
   'موعدك {ref} يقترب. إذا لم تتمكن من الحضور، ألغِه أو غيّر موعده من التطبيق.'),
  ('booking.waitlist_opened', 'en', 1, 'A time opened at {business}',
   '{service} at {when} is free again. It is not held for you: book now to take it.'),
  ('booking.waitlist_opened', 'ar', 1, 'توفر موعد لدى {business}',
   '{service} في {when} أصبح متاحًا. الموعد غير محجوز لك: احجز الآن للحصول عليه.');
