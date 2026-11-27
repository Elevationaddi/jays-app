-- Phase 1: identity, sessions, addresses, business shells, memberships, admin accounts, audit, outbox.
-- Forward-only. Rollback is a new migration (see docs/IMPLEMENTATION_STATUS.md, phase 1).
--
-- Conventions (docs/06-architecture-data.md, ADR-0005):
--   UUID primary keys, timestamptz in UTC, created_at/updated_at on mutable tables,
--   localized content as jsonb {"en": "...", "ar": "..."}, closed vocabularies as CHECK constraints.

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Localized text must carry both languages, each non-empty.
CREATE FUNCTION is_localized_text(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value) = 'object'
     AND jsonb_typeof(value -> 'en') = 'string'
     AND jsonb_typeof(value -> 'ar') = 'string'
     AND length(btrim(value ->> 'en')) > 0
     AND length(btrim(value ->> 'ar')) > 0
     AND (SELECT count(*) FROM jsonb_object_keys(value)) = 2;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reference data: emirates. Which ones are offered is an admin setting (ADR-0007, D11).
CREATE TABLE emirates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,3}$'),
  name jsonb NOT NULL CHECK (is_localized_text(name)),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER emirates_updated_at BEFORE UPDATE ON emirates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO emirates (code, name, sort_order) VALUES
  ('AUH', '{"en": "Abu Dhabi", "ar": "أبوظبي"}', 1),
  ('DXB', '{"en": "Dubai", "ar": "دبي"}', 2),
  ('SHJ', '{"en": "Sharjah", "ar": "الشارقة"}', 3),
  ('AJM', '{"en": "Ajman", "ar": "عجمان"}', 4),
  ('UAQ', '{"en": "Umm Al Quwain", "ar": "أم القيوين"}', 5),
  ('RAK', '{"en": "Ras Al Khaimah", "ar": "رأس الخيمة"}', 6),
  ('FUJ', '{"en": "Fujairah", "ar": "الفجيرة"}', 7);

-- ---------------------------------------------------------------------------------------------
-- Users: one identity for customers and business members. Admins are separate (admin_accounts).
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE CHECK (email IS NULL OR length(email) <= 254),
  email_verified_at timestamptz,
  phone text UNIQUE CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at timestamptz,
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'restricted', 'deactivated')),
  display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 80),
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  emirate_code text REFERENCES emirates (code),
  preferred_mode text CHECK (preferred_mode IN ('shop', 'services')),
  terms_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  marketing_consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (email_verified_at IS NULL OR email IS NOT NULL),
  CHECK (phone_verified_at IS NULL OR phone IS NOT NULL),
  -- An active account has at least one verified contact.
  CHECK (status <> 'active' OR email_verified_at IS NOT NULL OR phone_verified_at IS NOT NULL)
);
CREATE INDEX users_emirate_code_idx ON users (emirate_code);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One-time codes for contact verification and password reset. Codes are stored as keyed hashes.
-- user_id is NULL for decoy challenges issued when a contact is already registered or unknown,
-- so the API answers identically either way (no account enumeration). Decoys can never verify.
CREATE TABLE verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users (id),
  purpose text NOT NULL CHECK (purpose IN ('verify_contact', 'password_reset')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  resend_available_at timestamptz NOT NULL,
  send_count integer NOT NULL DEFAULT 1 CHECK (send_count >= 1),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_challenges_user_id_idx ON verification_challenges (user_id);
CREATE TRIGGER verification_challenges_updated_at BEFORE UPDATE ON verification_challenges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A session is one sign-in on one device. The refresh token is `<session id>.<secret>`; only a
-- SHA-256 of the current secret is stored. Presenting an older secret for the session means the
-- token was copied, so the whole session is revoked (reuse detection, ADR-0009).
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  refresh_hash text NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('logout', 'refresh_reuse', 'password_reset', 'admin')),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= absolute_expires_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  label text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 40),
  emirate_code text NOT NULL REFERENCES emirates (code),
  area text NOT NULL CHECK (length(btrim(area)) BETWEEN 1 AND 120),
  street text NOT NULL CHECK (length(btrim(street)) BETWEEN 1 AND 160),
  building text NOT NULL CHECK (length(btrim(building)) BETWEEN 1 AND 120),
  unit text CHECK (unit IS NULL OR length(btrim(unit)) BETWEEN 1 AND 40),
  directions text CHECK (directions IS NULL OR length(directions) <= 500),
  latitude numeric(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (NOT (is_default AND archived_at IS NOT NULL))
);
CREATE INDEX addresses_user_id_idx ON addresses (user_id, created_at, id);
CREATE INDEX addresses_emirate_code_idx ON addresses (emirate_code);
CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id) WHERE is_default;
CREATE TRIGGER addresses_updated_at BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Businesses (shell in phase 1; legal details and review arrive in phase 2).
CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name jsonb NOT NULL CHECK (is_localized_text(display_name)),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'suspended')),
  legal_name text,
  license_expiry date,
  tax_id text,
  psp_account_ref text,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX businesses_created_by_idx ON businesses (created_by);
CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Staff are permission-scoped members, not a fourth role. Permissions are a closed vocabulary;
-- there is deliberately no value that maps to platform admin (docs/03-business.md).
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  user_id uuid NOT NULL REFERENCES users (id),
  permissions text[] NOT NULL CHECK (
    cardinality(permissions) >= 1
    AND permissions <@ ARRAY['owner', 'manager', 'fulfillment', 'scheduler', 'finance', 'professional']::text[]
  ),
  status text NOT NULL CHECK (status IN ('invited', 'active', 'removed')),
  invited_by uuid REFERENCES users (id),
  accepted_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id),
  CHECK (status <> 'active' OR accepted_at IS NOT NULL),
  CHECK ((status = 'removed') = (removed_at IS NOT NULL))
);
CREATE INDEX memberships_user_id_idx ON memberships (user_id);
CREATE INDEX memberships_invited_by_idx ON memberships (invited_by);
CREATE INDEX memberships_business_list_idx ON memberships (business_id, created_at, id);
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Each mode is activated independently. No row = not activated (the gateway shows onboarding).
-- Moving to 'active' is an admin approval (phase 2); phase 1 only reaches 'onboarding'.
CREATE TABLE business_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  mode text NOT NULL CHECK (mode IN ('shop', 'services')),
  status text NOT NULL DEFAULT 'onboarding'
    CHECK (status IN ('onboarding', 'pending_review', 'active', 'rejected', 'suspended')),
  activated_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, mode)
);
CREATE INDEX business_modes_activated_by_idx ON business_modes (activated_by);
CREATE TRIGGER business_modes_updated_at BEFORE UPDATE ON business_modes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Platform administrators: separately provisioned, invite-only, TOTP MFA mandatory (docs/04-admin.md).
CREATE TABLE admin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE CHECK (length(email) <= 254),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  password_hash text CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  -- AES-256-GCM encrypted TOTP secret (key: MFA_ENCRYPTION_KEY). Never stored in plain text.
  mfa_secret_enc text,
  mfa_enabled_at timestamptz,
  -- Last accepted TOTP time step; a code for the same or an earlier step is refused (replay).
  mfa_last_step bigint,
  invite_token_hash text UNIQUE,
  invite_expires_at timestamptz,
  invited_by uuid REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- An active admin always has a password and enabled MFA.
  CHECK (status <> 'active' OR (password_hash IS NOT NULL AND mfa_enabled_at IS NOT NULL AND mfa_secret_enc IS NOT NULL)),
  CHECK ((invite_token_hash IS NULL) = (invite_expires_at IS NULL))
);
CREATE INDEX admin_accounts_invited_by_idx ON admin_accounts (invited_by);
CREATE INDEX admin_accounts_list_idx ON admin_accounts (created_at, id);
CREATE TRIGGER admin_accounts_updated_at BEFORE UPDATE ON admin_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admin_accounts (id),
  role text NOT NULL
    CHECK (role IN ('superadmin', 'compliance', 'catalog', 'operations', 'finance', 'support', 'analyst')),
  granted_by uuid REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_id, role)
);
CREATE INDEX admin_roles_granted_by_idx ON admin_roles (granted_by);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admin_accounts (id),
  refresh_hash text NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('logout', 'refresh_reuse', 'password_reset', 'admin')),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= absolute_expires_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX admin_sessions_admin_id_idx ON admin_sessions (admin_id);
CREATE TRIGGER admin_sessions_updated_at BEFORE UPDATE ON admin_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Audit log: append-only. UPDATE and DELETE are rejected by trigger.
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_id uuid,
  action text NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text NOT NULL,
  target_id uuid,
  business_id uuid REFERENCES businesses (id),
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  redacted_diff jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_type = 'system' OR actor_id IS NOT NULL)
);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);
CREATE INDEX audit_logs_business_id_idx ON audit_logs (business_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_type, actor_id);
CREATE INDEX audit_logs_list_idx ON audit_logs (created_at DESC, id DESC);

CREATE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- Transactional outbox: events written in the same transaction as the change, delivered by the
-- worker (delivery handlers arrive with notifications in phase 6).
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE status = 'pending';
CREATE TRIGGER outbox_updated_at BEFORE UPDATE ON outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
