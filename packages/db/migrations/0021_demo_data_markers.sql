-- Staging demonstration data markers (ADR-0038).
-- Every user and business created by the demo loader is flagged, so the data can always be told
-- apart from real activity, and production refuses to report ready while any flagged row exists.
ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX users_is_demo_idx ON users (id) WHERE is_demo;
CREATE INDEX businesses_is_demo_idx ON businesses (id) WHERE is_demo;

-- Which environment this database belongs to. Set once (by the staging migrate workflow or the
-- demo loader) and never changed, so a staging tool cannot be pointed at a production database.
CREATE TABLE environment_marker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('local', 'test', 'staging', 'production')),
  marked_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION environment_marker_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'environment_marker cannot be changed or removed';
END;
$$;
CREATE TRIGGER environment_marker_immutable BEFORE UPDATE OR DELETE ON environment_marker
  FOR EACH ROW EXECUTE FUNCTION environment_marker_immutable();
