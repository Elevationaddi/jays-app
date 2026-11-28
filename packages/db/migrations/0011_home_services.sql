-- Phase 8.5: home services (ADR-0018 D9; ADR-0022).
--
-- 1. A service is offered at the venue, at the customer's home, or both.
-- 2. A business may offer home visits only after an admin approves its home-service licence
--    (D9). The profile holds the licence, the travel buffer and the minimum service amount.
-- 3. Coverage areas: an emirate, optionally narrowed to one area, each with a travel fee.
-- 4. A home booking stores the address as booked, the travel fee and the travel buffer. The
--    travel buffer widens the occupied interval on both sides, so the existing exclusion
--    constraint keeps a professional's visits from overlapping, travel included.

-- ---------------------------------------------------------------------------------------------
-- 1. Where a service is performed.
ALTER TABLE services ADD COLUMN location_mode text NOT NULL DEFAULT 'in_venue'
  CHECK (location_mode IN ('in_venue', 'home', 'both'));

-- The licence for home visits is uploaded like any other private document, also after approval.
ALTER TABLE verification_documents DROP CONSTRAINT verification_documents_kind_check;
ALTER TABLE verification_documents ADD CONSTRAINT verification_documents_kind_check CHECK (kind IN (
  'trade_license', 'tax_certificate', 'owner_identity', 'other', 'home_service_license'));

-- ---------------------------------------------------------------------------------------------
-- 2. Home-service profile, one per business.
CREATE TABLE home_service_profiles (
  business_id uuid PRIMARY KEY REFERENCES businesses (id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'suspended')),
  license_number text
    CHECK (license_number IS NULL OR license_number ~ '^[A-Za-z0-9][A-Za-z0-9/-]{2,39}$'),
  license_authority text
    CHECK (license_authority IS NULL OR length(btrim(license_authority)) BETWEEN 2 AND 120),
  license_expiry date,
  license_document_id uuid REFERENCES verification_documents (id),
  -- Minutes kept free before and after each visit for travel.
  travel_buffer_min smallint NOT NULL DEFAULT 30
    CHECK (travel_buffer_min BETWEEN 0 AND 120 AND travel_buffer_min % 5 = 0),
  -- The smallest service price (travel fee excluded) accepted for a home visit.
  min_order_fils integer NOT NULL DEFAULT 0 CHECK (min_order_fils BETWEEN 0 AND 100000000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES admin_accounts (id),
  review_reason text CHECK (review_reason IS NULL OR length(review_reason) BETWEEN 3 AND 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('draft', 'rejected') OR (
    license_number IS NOT NULL AND license_authority IS NOT NULL AND license_expiry IS NOT NULL
    AND license_document_id IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status NOT IN ('approved', 'rejected', 'suspended') OR
    (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)),
  CHECK (status NOT IN ('rejected', 'suspended') OR review_reason IS NOT NULL)
);
CREATE INDEX home_service_profiles_status_idx ON home_service_profiles (status, submitted_at);
CREATE INDEX home_service_profiles_document_idx ON home_service_profiles (license_document_id);
CREATE INDEX home_service_profiles_reviewed_by_idx ON home_service_profiles (reviewed_by);
CREATE TRIGGER home_service_profiles_updated_at BEFORE UPDATE ON home_service_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 3. Coverage areas. A null area covers the whole emirate; a named area overrides it.
CREATE TABLE home_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  emirate_code text NOT NULL REFERENCES emirates (code),
  area text CHECK (area IS NULL OR length(btrim(area)) BETWEEN 1 AND 120),
  travel_fee_fils integer NOT NULL CHECK (travel_fee_fils BETWEEN 0 AND 10000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT home_service_areas_scope_key
    UNIQUE NULLS NOT DISTINCT (business_id, emirate_code, area)
);
CREATE INDEX home_service_areas_emirate_idx ON home_service_areas (emirate_code);

-- ---------------------------------------------------------------------------------------------
-- 4. Home bookings.
ALTER TABLE bookings ADD COLUMN location_type text NOT NULL DEFAULT 'venue'
  CHECK (location_type IN ('venue', 'home'));
ALTER TABLE bookings ADD COLUMN home_address jsonb;
ALTER TABLE bookings ADD COLUMN travel_fee_fils integer NOT NULL DEFAULT 0
  CHECK (travel_fee_fils >= 0);
ALTER TABLE bookings ADD COLUMN travel_buffer_min smallint NOT NULL DEFAULT 0
  CHECK (travel_buffer_min BETWEEN 0 AND 120);
ALTER TABLE bookings ADD CONSTRAINT bookings_home_address
  CHECK ((location_type = 'home') = (home_address IS NOT NULL));
ALTER TABLE bookings ADD CONSTRAINT bookings_venue_no_travel
  CHECK (location_type = 'home' OR (travel_fee_fils = 0 AND travel_buffer_min = 0));
ALTER TABLE bookings ADD CONSTRAINT bookings_travel_within_price
  CHECK (travel_fee_fils < price_fils);

-- ---------------------------------------------------------------------------------------------
-- 5. Account deletion (ADR-0019) also clears the address and contact details kept on the
--    customer's bookings. The booking itself stays for the business's and tax records.
CREATE FUNCTION scrub_deleted_user_bookings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE bookings SET
    customer_name = NULL,
    customer_phone = NULL,
    home_address = CASE WHEN home_address IS NULL THEN NULL ELSE jsonb_build_object(
      'addressId', home_address->>'addressId', 'label', NULL,
      'emirate', home_address->>'emirate', 'area', 'deleted', 'street', 'deleted',
      'building', 'deleted', 'unit', NULL, 'directions', NULL) END
   WHERE user_id = NEW.id AND source = 'customer';
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_deleted_scrub_bookings AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION scrub_deleted_user_bookings();
