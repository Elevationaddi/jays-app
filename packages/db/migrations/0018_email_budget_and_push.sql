-- Phase 9.2: Resend email and Firebase Cloud Messaging push (ADR-0031).
--
--   1. Email usage per UTC day, so the API stays inside Resend Free (100 a day, 3,000 a month)
--      and keeps the last part of each day for security email.
--   2. Push devices: one row per FCM registration token. A token belongs to the user who last
--      registered it; tokens FCM reports as invalid are revoked.
--   3. Push is a delivery channel like email, recorded once per event and user.

-- 1. Email usage.
CREATE TABLE email_usage (
  day date PRIMARY KEY,
  essential integer NOT NULL DEFAULT 0 CHECK (essential >= 0),
  other integer NOT NULL DEFAULT 0 CHECK (other >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Push devices.
CREATE TABLE push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  token text NOT NULL UNIQUE CHECK (length(token) BETWEEN 20 AND 4096),
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR revoke_reason IN ('signed_out', 'invalid', 'replaced'))
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id) WHERE revoked_at IS NULL;

-- 3. Push deliveries.
ALTER TABLE notification_deliveries DROP CONSTRAINT notification_deliveries_channel_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('email', 'sms', 'push'));

-- 4. Deleting an account removes its push tokens (the anonymisation job sets deleted_at).
CREATE FUNCTION push_devices_forget_deleted_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    DELETE FROM push_devices WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_forget_push_devices AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW EXECUTE FUNCTION push_devices_forget_deleted_user();
