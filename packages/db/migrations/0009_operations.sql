-- Phase 8.3: operations controls (ADR-0018 D10, D11, D12; ADR-0020).
--
-- 1. Categories can be switched off without archiving them (D10, D11). A switched-off category,
--    or one under a switched-off parent, hides its products and services from customers.
-- 2. The category tree follows the D10 lists. Medical and clinical services stay absent.
-- 3. Support tickets gain a priority, an escalation path for payment and security incidents, the
--    time of the first support reply, and customer attachments that are scanned before use (D12).

ALTER TABLE categories ADD COLUMN enabled boolean NOT NULL DEFAULT true;

-- A category is live when it and every ancestor are active and enabled (the tree is at most three
-- levels deep).
CREATE FUNCTION category_is_live(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, status, enabled FROM categories WHERE id = p_id
    UNION ALL
    SELECT c.id, c.parent_id, c.status, c.enabled
      FROM categories c JOIN up ON c.id = up.parent_id
  )
  SELECT coalesce(bool_and(status = 'active' AND enabled), false) FROM up
$$;

-- D10 product and service lists. Existing slugs keep their ids; names follow the founder's wording.
UPDATE categories SET name = '{"en": "Perfumes", "ar": "العطور"}' WHERE mode = 'shop' AND slug = 'fragrance';
UPDATE categories SET name = '{"en": "Clothing", "ar": "الملابس"}' WHERE mode = 'shop' AND slug = 'fashion';
UPDATE categories SET name = '{"en": "Hair salons", "ar": "صالونات الشعر"}' WHERE mode = 'services' AND slug = 'hair';
UPDATE categories SET name = '{"en": "Spa (non-medical)", "ar": "السبا (غير طبي)"}' WHERE mode = 'services' AND slug = 'spa';
INSERT INTO categories (mode, slug, name, sort_order) VALUES
  ('shop', 'beauty', '{"en": "Beauty", "ar": "الجمال"}', 0),
  ('shop', 'footwear', '{"en": "Footwear", "ar": "الأحذية"}', 8),
  ('shop', 'jewelry', '{"en": "Jewelry", "ar": "المجوهرات"}', 9),
  ('shop', 'lifestyle', '{"en": "Lifestyle", "ar": "أسلوب الحياة"}', 10),
  ('services', 'waxing', '{"en": "Waxing", "ar": "إزالة الشعر بالشمع"}', 7),
  ('services', 'barbering', '{"en": "Barbering", "ar": "الحلاقة الرجالية"}', 8)
ON CONFLICT (mode, slug) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Support.
ALTER TABLE support_tickets ADD COLUMN priority text NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE support_tickets ADD COLUMN escalation text
  CHECK (escalation IS NULL OR escalation IN ('payment', 'security', 'operations'));
ALTER TABLE support_tickets ADD COLUMN escalated_at timestamptz;
ALTER TABLE support_tickets ADD COLUMN first_response_at timestamptz;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_escalation_time
  CHECK ((escalation IS NULL) = (escalated_at IS NULL));
-- Payment questions start high.
UPDATE support_tickets SET priority = 'high' WHERE type = 'payment';
-- Tickets that already have a support reply count it as the first response.
UPDATE support_tickets t SET first_response_at = m.first_at
  FROM (SELECT ticket_id, min(created_at) AS first_at FROM ticket_messages
         WHERE author_type = 'admin' AND NOT internal GROUP BY ticket_id) m
 WHERE m.ticket_id = t.id;
CREATE INDEX support_tickets_escalated_idx ON support_tickets (escalated_at)
  WHERE escalation IS NOT NULL AND status <> 'resolved';

CREATE TABLE ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets (id),
  author_type text NOT NULL CHECK (author_type IN ('customer', 'admin')),
  author_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE CHECK (object_key LIKE 'private/%'),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  declared_size_bytes integer NOT NULL CHECK (declared_size_bytes BETWEEN 1 AND 10485760),
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 10485760),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'clean', 'infected', 'rejected')),
  rejection_reason text CHECK (rejection_reason IS NULL OR rejection_reason IN (
    'type_mismatch', 'too_large', 'empty', 'malware')),
  upload_expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'clean' OR (uploaded_at IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)),
  CHECK ((status IN ('infected', 'rejected')) = (rejection_reason IS NOT NULL))
);
CREATE INDEX ticket_attachments_ticket_idx ON ticket_attachments (ticket_id, created_at, id);
CREATE TRIGGER ticket_attachments_updated_at BEFORE UPDATE ON ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
