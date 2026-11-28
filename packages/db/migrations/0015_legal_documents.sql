-- Phase 8.8 (part 2): legal documents and acceptance records (D13; ADR-0028).
--
-- Every document is a draft awaiting review by a UAE lawyer. A version is written as a draft,
-- then published so it is shown to people and can be accepted. Publishing freezes its text:
-- a change is a new version. There is deliberately no column that marks a document legally
-- approved; recording a lawyer's sign-off will be added when one is appointed (ADR-0028), and
-- the API refuses to publish in production until then.
--
-- Acceptances are append-only: who accepted which version, when, in which language and how.

CREATE TABLE legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'customer_terms', 'merchant_agreement', 'privacy_policy', 'returns_refunds',
    'appointment_cancellation', 'home_services', 'marketing_consent', 'prohibited_items',
    'review_moderation', 'merchant_licensing', 'authenticity', 'promotional_pricing')),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  title jsonb NOT NULL CHECK (
    jsonb_typeof(title) = 'object'
    AND length(btrim(title ->> 'en')) BETWEEN 1 AND 200
    AND length(btrim(title ->> 'ar')) BETWEEN 1 AND 200),
  body jsonb NOT NULL CHECK (
    jsonb_typeof(body) = 'object'
    AND length(btrim(body ->> 'en')) BETWEEN 1 AND 60000
    AND length(btrim(body ->> 'ar')) BETWEEN 1 AND 60000),
  summary_of_changes text CHECK (summary_of_changes IS NULL OR length(summary_of_changes) <= 1000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  effective_at timestamptz,
  created_by uuid REFERENCES admin_accounts (id),
  published_by uuid REFERENCES admin_accounts (id),
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version),
  CHECK ((status = 'draft') = (published_at IS NULL)),
  CHECK (status = 'draft' OR effective_at IS NOT NULL),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
-- At most one version of each document is in force.
CREATE UNIQUE INDEX legal_documents_one_published ON legal_documents (kind)
  WHERE status = 'published';
CREATE TRIGGER legal_documents_updated_at BEFORE UPDATE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A published or retired version's text never changes, and it is never deleted.
CREATE FUNCTION legal_documents_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'a published legal document cannot be deleted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
      NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
      OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR (OLD.status = 'retired' AND NEW.status <> 'retired')) THEN
    RAISE EXCEPTION 'a published legal document is frozen; publish a new version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legal_documents_freeze BEFORE UPDATE OR DELETE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION legal_documents_freeze();

CREATE TABLE legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  document_id uuid NOT NULL REFERENCES legal_documents (id),
  kind text NOT NULL,
  version integer NOT NULL,
  -- The business a merchant agreement was accepted for.
  business_id uuid REFERENCES businesses (id),
  locale text NOT NULL CHECK (locale IN ('en', 'ar')),
  source text NOT NULL CHECK (source IN ('sign_up', 'reaccept', 'merchant_onboarding')),
  request_id text CHECK (request_id IS NULL OR length(request_id) <= 100),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'merchant_agreement') = (business_id IS NOT NULL))
);
CREATE UNIQUE INDEX legal_acceptances_once ON legal_acceptances
  (user_id, document_id, COALESCE(business_id, '00000000-0000-0000-0000-000000000000'));
CREATE INDEX legal_acceptances_user_idx ON legal_acceptances (user_id, kind);
CREATE INDEX legal_acceptances_business_idx ON legal_acceptances (business_id)
  WHERE business_id IS NOT NULL;
CREATE TRIGGER legal_acceptances_no_update BEFORE UPDATE OR DELETE ON legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- The acceptance must name the document's own kind and version, and only a published one.
CREATE FUNCTION legal_acceptances_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d legal_documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM legal_documents WHERE id = NEW.document_id;
  IF d.status <> 'published' OR d.kind <> NEW.kind OR d.version <> NEW.version THEN
    RAISE EXCEPTION 'only the published version can be accepted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legal_acceptances_check BEFORE INSERT ON legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION legal_acceptances_check();
