-- Phase 2: merchant onboarding and review, private verification documents, media, category
-- taxonomy, brands and storefronts. Forward-only (see docs/IMPLEMENTATION_STATUS.md, phase 2).
--
-- Visibility rule enforced by every public query: a business is public only when
-- businesses.status = 'approved' and the mode is business_modes.status = 'active'. Storefront
-- content is public only from the live_* columns, which are copied from the draft columns when an
-- admin approves (docs/01-product.md: no public listing before approval).

-- ---------------------------------------------------------------------------------------------
-- Businesses: legal profile, address, merchant agreement and review state.
ALTER TABLE businesses
  ADD COLUMN trade_license_number text
    CHECK (trade_license_number IS NULL OR trade_license_number ~ '^[A-Za-z0-9][A-Za-z0-9/-]{2,39}$'),
  ADD COLUMN license_authority text
    CHECK (license_authority IS NULL OR length(btrim(license_authority)) BETWEEN 2 AND 120),
  ADD COLUMN tax_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN address_emirate_code text REFERENCES emirates (code),
  ADD COLUMN address_area text CHECK (address_area IS NULL OR length(btrim(address_area)) BETWEEN 1 AND 120),
  ADD COLUMN address_street text CHECK (address_street IS NULL OR length(btrim(address_street)) BETWEEN 1 AND 160),
  ADD COLUMN address_building text CHECK (address_building IS NULL OR length(btrim(address_building)) BETWEEN 1 AND 120),
  ADD COLUMN address_unit text CHECK (address_unit IS NULL OR length(btrim(address_unit)) BETWEEN 1 AND 40),
  ADD COLUMN agreement_version text,
  ADD COLUMN agreement_accepted_at timestamptz,
  ADD COLUMN agreement_accepted_by uuid REFERENCES users (id),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES admin_accounts (id),
  ADD COLUMN review_reason text CHECK (review_reason IS NULL OR length(review_reason) <= 1000),
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspension_reason text CHECK (suspension_reason IS NULL OR length(suspension_reason) <= 1000),
  -- Optimistic concurrency for admin actions ("version precondition", docs/07-api.md).
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD CONSTRAINT businesses_legal_name_check
    CHECK (legal_name IS NULL OR length(btrim(legal_name)) BETWEEN 2 AND 200),
  -- UAE tax registration number: 15 digits.
  ADD CONSTRAINT businesses_tax_id_check CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{15}$'),
  ADD CONSTRAINT businesses_agreement_check
    CHECK ((agreement_accepted_at IS NULL) = (agreement_version IS NULL)
       AND (agreement_accepted_at IS NULL) = (agreement_accepted_by IS NULL)),
  -- Once submitted, the legal profile is complete. Drafts may be partial.
  ADD CONSTRAINT businesses_submitted_complete_check CHECK (
    status = 'draft' OR (
      legal_name IS NOT NULL AND trade_license_number IS NOT NULL AND license_authority IS NOT NULL
      AND license_expiry IS NOT NULL AND address_emirate_code IS NOT NULL AND address_area IS NOT NULL
      AND address_street IS NOT NULL AND address_building IS NOT NULL
      AND agreement_accepted_at IS NOT NULL AND submitted_at IS NOT NULL
      AND (NOT tax_registered OR tax_id IS NOT NULL)
    )
  ),
  ADD CONSTRAINT businesses_rejected_reason_check CHECK (status <> 'rejected' OR review_reason IS NOT NULL),
  ADD CONSTRAINT businesses_reviewed_check
    CHECK (status NOT IN ('approved', 'rejected', 'suspended') OR reviewed_at IS NOT NULL),
  ADD CONSTRAINT businesses_suspended_check CHECK (
    (status = 'suspended') = (suspended_at IS NOT NULL)
    AND (status <> 'suspended' OR suspension_reason IS NOT NULL)
  );
CREATE INDEX businesses_review_queue_idx ON businesses (status, submitted_at, id);
CREATE INDEX businesses_address_emirate_code_idx ON businesses (address_emirate_code);
CREATE INDEX businesses_agreement_accepted_by_idx ON businesses (agreement_accepted_by);
CREATE INDEX businesses_reviewed_by_idx ON businesses (reviewed_by);

-- Each mode is reviewed separately, so a hybrid can be approved for one mode and not the other.
ALTER TABLE business_modes
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_reason text CHECK (review_reason IS NULL OR length(review_reason) <= 1000),
  ADD CONSTRAINT business_modes_rejected_reason_check CHECK (status <> 'rejected' OR review_reason IS NOT NULL),
  ADD CONSTRAINT business_modes_reviewed_check CHECK (status NOT IN ('active', 'rejected') OR reviewed_at IS NOT NULL);
CREATE INDEX business_modes_pending_idx ON business_modes (status) WHERE status = 'pending_review';

-- ---------------------------------------------------------------------------------------------
-- Private verification documents (trade licence, tax certificate, ...). Uploaded straight to
-- object storage with a short-lived signed URL, then checked (size, real file type, malware scan)
-- before they count. Only the business owner and authorised admin reviewers can read them, and
-- every read is audited.
CREATE TABLE verification_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  kind text NOT NULL CHECK (kind IN ('trade_license', 'tax_certificate', 'owner_identity', 'other')),
  object_key text NOT NULL UNIQUE CHECK (object_key LIKE 'private/%'),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  declared_size_bytes integer NOT NULL CHECK (declared_size_bytes BETWEEN 1 AND 10485760),
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 10485760),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'clean', 'infected', 'rejected', 'archived')),
  rejection_reason text CHECK (rejection_reason IS NULL OR rejection_reason IN ('type_mismatch', 'too_large', 'empty', 'malware')),
  upload_expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('clean') OR (uploaded_at IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)),
  CHECK ((status IN ('infected', 'rejected')) = (rejection_reason IS NOT NULL)),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX verification_documents_business_idx ON verification_documents (business_id, created_at, id);
CREATE INDEX verification_documents_uploaded_by_idx ON verification_documents (uploaded_by);
CREATE TRIGGER verification_documents_updated_at BEFORE UPDATE ON verification_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Media (images). Validated like documents, plus image dimensions per purpose. Served publicly
-- only while attached to live, approved content.
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  purpose text NOT NULL CHECK (purpose IN ('storefront_logo', 'storefront_banner')),
  object_key text NOT NULL UNIQUE CHECK (object_key LIKE 'media/%'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  declared_size_bytes integer NOT NULL CHECK (declared_size_bytes BETWEEN 1 AND 5242880),
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 5242880),
  width integer CHECK (width IS NULL OR width BETWEEN 1 AND 10000),
  height integer CHECK (height IS NULL OR height BETWEEN 1 AND 10000),
  status text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload', 'ready', 'rejected')),
  rejection_reason text CHECK (rejection_reason IS NULL OR rejection_reason IN (
    'type_mismatch', 'too_large', 'empty', 'malware', 'dimensions')),
  upload_expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  CHECK (status <> 'ready' OR (width IS NOT NULL AND height IS NOT NULL AND size_bytes IS NOT NULL AND uploaded_at IS NOT NULL)),
  CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL))
);
CREATE INDEX media_business_idx ON media (business_id, created_at, id);
CREATE INDEX media_created_by_idx ON media (created_by);
CREATE TRIGGER media_updated_at BEFORE UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Storefront: one per business. The merchant edits the draft columns; live_* is what customers
-- see. Approval copies draft to live. After approval, edits are "material changes" that wait for
-- review (docs/03-business.md) while the previous live version stays public.
CREATE TABLE storefronts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES businesses (id),
  name jsonb CHECK (name IS NULL OR is_localized_text(name)),
  description jsonb CHECK (description IS NULL OR is_localized_text(description)),
  logo_media_id uuid,
  banner_media_id uuid,
  live_name jsonb CHECK (live_name IS NULL OR is_localized_text(live_name)),
  live_description jsonb CHECK (live_description IS NULL OR is_localized_text(live_description)),
  live_logo_media_id uuid,
  live_banner_media_id uuid,
  published_at timestamptz,
  changes_submitted_at timestamptz,
  changes_review_reason text CHECK (changes_review_reason IS NULL OR length(changes_review_reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Media must belong to the same business (no cross-tenant references).
  FOREIGN KEY (logo_media_id, business_id) REFERENCES media (id, business_id),
  FOREIGN KEY (banner_media_id, business_id) REFERENCES media (id, business_id),
  FOREIGN KEY (live_logo_media_id, business_id) REFERENCES media (id, business_id),
  FOREIGN KEY (live_banner_media_id, business_id) REFERENCES media (id, business_id),
  CHECK ((published_at IS NULL) = (live_name IS NULL)),
  CHECK (live_name IS NULL OR live_description IS NOT NULL)
);
CREATE INDEX storefronts_logo_idx ON storefronts (logo_media_id);
CREATE INDEX storefronts_banner_idx ON storefronts (banner_media_id);
CREATE INDEX storefronts_live_logo_idx ON storefronts (live_logo_media_id);
CREATE INDEX storefronts_live_banner_idx ON storefronts (live_banner_media_id);
CREATE INDEX storefronts_changes_idx ON storefronts (changes_submitted_at) WHERE changes_submitted_at IS NOT NULL;
CREATE TRIGGER storefronts_updated_at BEFORE UPDATE ON storefronts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Category taxonomy, one tree per mode, at most three levels. A child always has its parent's
-- mode (composite foreign key). Categories are archived, never deleted.
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid,
  mode text NOT NULL CHECK (mode IN ('shop', 'services')),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  name jsonb NOT NULL CHECK (is_localized_text(name)),
  depth smallint NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 2),
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mode, slug),
  UNIQUE (id, mode),
  FOREIGN KEY (parent_id, mode) REFERENCES categories (id, mode),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX categories_parent_idx ON categories (parent_id);
CREATE INDEX categories_tree_idx ON categories (mode, depth, sort_order, id);
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Depth follows the parent; the parent cannot change afterwards (moving subtrees is not supported).
CREATE FUNCTION categories_set_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_depth smallint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'a category cannot be moved' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
  ELSE
    SELECT depth INTO parent_depth FROM categories WHERE id = NEW.parent_id;
    NEW.depth := coalesce(parent_depth, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER categories_depth BEFORE INSERT OR UPDATE OF parent_id, depth ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_set_depth();

-- MVP taxonomy from docs/01-product.md. Medical procedures and regulated goods are deliberately
-- absent until separately approved (ADR-0007, D10). Admins manage the tree from here.
INSERT INTO categories (mode, slug, name, sort_order) VALUES
  ('shop', 'makeup', '{"en": "Makeup", "ar": "المكياج"}', 1),
  ('shop', 'skincare', '{"en": "Skincare", "ar": "العناية بالبشرة"}', 2),
  ('shop', 'haircare', '{"en": "Haircare", "ar": "العناية بالشعر"}', 3),
  ('shop', 'fragrance', '{"en": "Fragrance", "ar": "العطور"}', 4),
  ('shop', 'fashion', '{"en": "Fashion", "ar": "الأزياء"}', 5),
  ('shop', 'accessories', '{"en": "Accessories", "ar": "الإكسسوارات"}', 6),
  ('shop', 'bath-body', '{"en": "Bath & body", "ar": "الاستحمام والجسم"}', 7),
  ('services', 'hair', '{"en": "Hair", "ar": "الشعر"}', 1),
  ('services', 'nails', '{"en": "Nails", "ar": "الأظافر"}', 2),
  ('services', 'makeup', '{"en": "Makeup", "ar": "المكياج"}', 3),
  ('services', 'brows-lashes', '{"en": "Brows & lashes", "ar": "الحواجب والرموش"}', 4),
  ('services', 'spa', '{"en": "Spa", "ar": "السبا"}', 5),
  ('services', 'wellness', '{"en": "Wellness (non-medical)", "ar": "العافية (غير طبية)"}', 6);

-- ---------------------------------------------------------------------------------------------
-- Brands are platform-managed (a brand can span merchants, docs/02-customer.md).
CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  name jsonb NOT NULL CHECK (is_localized_text(name)),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brands_list_idx ON brands (status, slug);
CREATE INDEX brands_created_by_idx ON brands (created_by);
CREATE TRIGGER brands_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
