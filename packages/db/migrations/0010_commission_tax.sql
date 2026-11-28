-- Phase 8.4: commission, VAT, tax documents and weekly payouts (ADR-0018 D2, D3, D4, D6; ADR-0021).
--
-- 1. Commission rules can target a category as well as a business and transaction type (D2).
-- 2. Prices stay VAT-inclusive. A business that is not VAT registered (businesses.tax_registered
--    and its TRN tax_id, captured at onboarding) charges no VAT (D4). No schema change needed.
-- 3. The platform charges VAT on its commission once it is registered (a finance setting, off by
--    default). Commission VAT is kept on the earning and posted to its own ledger account.
-- 4. Tax documents: the business's invoice to the customer and the platform's commission invoice
--    to the business, with credit notes for refunds and lost disputes. JAYS is a disclosed
--    intermediary, not the seller (D3). Documents are append-only and numbered per issuer.
-- 5. Weekly payout runs, one per week (D6).

-- ---------------------------------------------------------------------------------------------
-- 1. Commission rules by category.
ALTER TABLE fee_rules ADD COLUMN category_id uuid REFERENCES categories (id);
ALTER TABLE fee_rules DROP CONSTRAINT fee_rules_mode_business_id_effective_at_key;
ALTER TABLE fee_rules ADD CONSTRAINT fee_rules_scope_effective_key
  UNIQUE NULLS NOT DISTINCT (mode, business_id, category_id, effective_at);

-- ---------------------------------------------------------------------------------------------
-- 3. Commission VAT and new settings.
ALTER TABLE finance_settings DROP CONSTRAINT finance_settings_key_check;
ALTER TABLE finance_settings ADD CONSTRAINT finance_settings_key_check CHECK (key IN (
  'refund_approval_threshold_fils', 'payout_dispute_window_days', 'payout_minimum_fils',
  'platform_vat_registered', 'commission_vat_bps', 'payout_weekday'));

ALTER TABLE merchant_earnings ADD COLUMN commission_vat_bps integer NOT NULL DEFAULT 0
  CHECK (commission_vat_bps BETWEEN 0 AND 10000);
ALTER TABLE merchant_earnings ADD COLUMN commission_vat_fils integer NOT NULL DEFAULT 0
  CHECK (commission_vat_fils >= 0);
ALTER TABLE merchant_earnings ADD COLUMN commission_vat_refunded_fils integer NOT NULL DEFAULT 0
  CHECK (commission_vat_refunded_fils BETWEEN 0 AND commission_vat_fils);
-- Per line: the rule, rate and base that produced the commission, copied at capture (T13).
ALTER TABLE merchant_earnings ADD COLUMN commission_detail jsonb NOT NULL DEFAULT '[]';
ALTER TABLE merchant_earnings ADD CONSTRAINT merchant_earnings_fee_within_gross
  CHECK (commission_fils + commission_vat_fils <= gross_fils);

ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_account_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_account_check CHECK (account IN (
  'psp_clearing', 'merchant_payable', 'payouts_in_transit', 'platform_commission',
  'platform_output_vat', 'unallocated_receipts'));

-- ---------------------------------------------------------------------------------------------
-- 4. Tax documents.
CREATE TABLE document_sequences (
  issuer_key text NOT NULL,
  prefix text NOT NULL,
  year integer NOT NULL,
  last_number integer NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (issuer_key, prefix, year)
);

CREATE TABLE tax_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'customer_invoice', 'customer_credit_note', 'commission_invoice', 'commission_credit_note')),
  -- The business issues customer documents; the platform issues commission documents.
  issuer text NOT NULL CHECK (issuer IN ('business', 'platform')),
  business_id uuid NOT NULL REFERENCES businesses (id),
  customer_user_id uuid REFERENCES users (id),
  number text NOT NULL,
  earning_id uuid NOT NULL REFERENCES merchant_earnings (id),
  source_type text NOT NULL CHECK (source_type IN ('merchant_earning', 'refund', 'dispute')),
  source_id uuid NOT NULL,
  credits_document_id uuid REFERENCES tax_documents (id),
  -- True when the issuer was VAT registered: a tax invoice or tax credit note.
  tax_document boolean NOT NULL,
  seller jsonb NOT NULL,
  buyer jsonb NOT NULL,
  lines jsonb NOT NULL,
  net_fils integer NOT NULL CHECK (net_fils >= 0),
  vat_fils integer NOT NULL CHECK (vat_fils >= 0),
  total_fils integer NOT NULL CHECK (total_fils > 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  -- False until a UAE tax professional approves the tax rules (D4); shown as a draft.
  rules_approved boolean NOT NULL,
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_type, source_id),
  UNIQUE (issuer, business_id, number),
  CHECK (net_fils + vat_fils = total_fils),
  CHECK ((issuer = 'business') = (kind IN ('customer_invoice', 'customer_credit_note'))),
  CHECK ((kind IN ('customer_invoice', 'customer_credit_note')) = (customer_user_id IS NOT NULL)),
  CHECK ((kind IN ('customer_credit_note', 'commission_credit_note')) = (credits_document_id IS NOT NULL))
);
CREATE INDEX tax_documents_business_idx ON tax_documents (business_id, issued_at DESC, id);
CREATE INDEX tax_documents_customer_idx ON tax_documents (customer_user_id, issued_at DESC)
  WHERE customer_user_id IS NOT NULL;
CREATE INDEX tax_documents_issued_idx ON tax_documents (issued_at);
CREATE INDEX tax_documents_earning_idx ON tax_documents (earning_id);
CREATE TRIGGER tax_documents_append_only BEFORE UPDATE OR DELETE ON tax_documents
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- ---------------------------------------------------------------------------------------------
-- 5. Weekly payout runs: one row per scheduled day, so several API instances run it once.
CREATE TABLE payout_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for date NOT NULL UNIQUE,
  made_eligible integer,
  payouts integer,
  skipped integer,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
