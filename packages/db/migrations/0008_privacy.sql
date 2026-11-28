-- Phase 8.2: account and privacy (ADR-0018 D14, D15; ADR-0019).
--
-- 1. Marketing consent becomes granular per channel. The current choice lives on the user row for
--    fast checks; every grant and withdrawal is also written to an append-only history with its
--    source, language and policy version, so consent can be proven and withdrawals are never lost.
-- 2. Transactional notification preferences (email, SMS, push) are separate from marketing.
--    In-app notifications and security messages (verification codes, password resets) always send.
-- 3. Account deletion: a request with a grace period, after which the worker anonymises the
--    account. Orders, payments, invoices and tickets are kept for legal and tax retention, but no
--    longer point to a person.

ALTER TABLE users ADD COLUMN marketing_email boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN marketing_sms boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN marketing_push boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN notify_email boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN notify_sms boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN notify_push boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_deleted_is_deactivated
  CHECK (deleted_at IS NULL OR status = 'deactivated');

-- ---------------------------------------------------------------------------------------------
-- Consent history. One row per change and channel; never updated or deleted.
CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  purpose text NOT NULL CHECK (purpose IN ('marketing_email', 'marketing_sms', 'marketing_push')),
  granted boolean NOT NULL,
  source text NOT NULL CHECK (source IN (
    'signup', 'settings', 'unsubscribe_link', 'account_deletion', 'migration')),
  -- The language the consent wording was shown in.
  locale text NOT NULL CHECK (locale IN ('en', 'ar')),
  policy_version text NOT NULL CHECK (length(btrim(policy_version)) BETWEEN 1 AND 50),
  request_id text CHECK (request_id IS NULL OR length(request_id) <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_records_user_idx ON consent_records (user_id, created_at DESC, id DESC);
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- Carry the old single flag over: a "yes" meant every channel, under the terms version accepted.
UPDATE users SET marketing_email = true, marketing_sms = true, marketing_push = true
 WHERE marketing_consent;
INSERT INTO consent_records (user_id, purpose, granted, source, locale, policy_version, created_at)
SELECT u.id, p.purpose, true, 'migration', u.locale, u.terms_version,
       coalesce(u.marketing_consent_at, u.created_at)
  FROM users u
 CROSS JOIN (VALUES ('marketing_email'), ('marketing_sms'), ('marketing_push')) AS p (purpose)
 WHERE u.marketing_consent;
ALTER TABLE users DROP COLUMN marketing_consent;
ALTER TABLE users DROP COLUMN marketing_consent_at;

-- ---------------------------------------------------------------------------------------------
-- Account deletion requests. pending -> canceled | completed. One pending request per user.
CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'canceled', 'completed')),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,
  canceled_at timestamptz,
  completed_at timestamptz,
  -- Why the last completion attempt was put off (for example an order still in transit).
  postponed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_for >= requested_at),
  CHECK ((status = 'canceled') = (canceled_at IS NOT NULL)),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX account_deletion_requests_one_pending
  ON account_deletion_requests (user_id) WHERE status = 'pending';
CREATE INDEX account_deletion_requests_due_idx
  ON account_deletion_requests (scheduled_for) WHERE status = 'pending';
CREATE INDEX account_deletion_requests_user_idx ON account_deletion_requests (user_id);
CREATE TRIGGER account_deletion_requests_updated_at BEFORE UPDATE ON account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sessions DROP CONSTRAINT sessions_revoke_reason_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_revoke_reason_check
  CHECK (revoke_reason IN ('logout', 'refresh_reuse', 'password_reset', 'admin', 'account_deleted'));

-- What stops an account from being deleted right now, or NULL. Shared by the API (at request
-- time) and the completion sweep (activity can start during the grace period).
CREATE FUNCTION account_open_activity(p_user uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM memberships WHERE user_id = p_user AND status = 'active')
      THEN 'business_member'
    WHEN EXISTS (
      SELECT 1 FROM merchant_orders mo JOIN orders o ON o.id = mo.order_id
       WHERE o.user_id = p_user AND mo.status IN ('pending_payment', 'paid', 'processing', 'shipped'))
      THEN 'open_orders'
    WHEN EXISTS (
      SELECT 1 FROM bookings
       WHERE user_id = p_user AND status IN ('held', 'confirmed', 'checked_in'))
      THEN 'upcoming_bookings'
    WHEN EXISTS (
      SELECT 1 FROM return_requests
       WHERE user_id = p_user
         AND status IN ('requested', 'approved', 'received', 'refund_pending', 'refund_failed'))
      THEN 'open_returns'
    ELSE NULL
  END
$$;

-- Completes due deletion requests. Activity that started in the grace period postpones the
-- request by a day instead of deleting under it. Returns how many accounts were anonymised.
CREATE FUNCTION complete_account_deletions(p_now timestamptz, p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  blocker text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT d.id, d.user_id FROM account_deletion_requests d
     WHERE d.status = 'pending' AND d.scheduled_for <= p_now
     ORDER BY d.scheduled_for, d.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM 1 FROM users WHERE id = r.user_id FOR UPDATE;
    blocker := account_open_activity(r.user_id);
    IF blocker IS NOT NULL THEN
      UPDATE account_deletion_requests
         SET scheduled_for = p_now + interval '1 day', postponed_reason = blocker
       WHERE id = r.id;
      CONTINUE;
    END IF;

    INSERT INTO consent_records (user_id, purpose, granted, source, locale, policy_version)
    SELECT u.id, p.purpose, false, 'account_deletion', u.locale, 'account-deletion'
      FROM users u
     CROSS JOIN LATERAL (VALUES
       ('marketing_email', u.marketing_email),
       ('marketing_sms', u.marketing_sms),
       ('marketing_push', u.marketing_push)) AS p (purpose, on_now)
     WHERE u.id = r.user_id AND p.on_now;

    UPDATE users SET
      email = 'deleted-' || id || '@deleted.invalid',
      email_verified_at = NULL,
      phone = NULL,
      phone_verified_at = NULL,
      -- Not a valid argon2 hash, so no password can ever match it.
      password_hash = '$argon2id$deleted',
      status = 'deactivated',
      display_name = NULL,
      emirate_code = NULL,
      preferred_mode = NULL,
      marketing_email = false, marketing_sms = false, marketing_push = false,
      notify_email = false, notify_sms = false, notify_push = false,
      deleted_at = p_now
     WHERE id = r.user_id;

    UPDATE addresses SET
      label = NULL, area = 'deleted', street = 'deleted', building = 'deleted', unit = NULL,
      directions = NULL, latitude = NULL, longitude = NULL, is_default = false,
      archived_at = coalesce(archived_at, p_now)
     WHERE user_id = r.user_id;

    UPDATE sessions SET revoked_at = p_now, revoke_reason = 'account_deleted'
     WHERE user_id = r.user_id AND revoked_at IS NULL;

    DELETE FROM verification_challenges WHERE user_id = r.user_id;

    UPDATE memberships SET status = 'removed', removed_at = p_now
     WHERE user_id = r.user_id AND status = 'invited';

    UPDATE account_deletion_requests
       SET status = 'completed', completed_at = p_now, postponed_reason = NULL
     WHERE id = r.id;

    INSERT INTO audit_logs (actor_type, action, target_type, target_id)
      VALUES ('system', 'user.deleted', 'user', r.user_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
