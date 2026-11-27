-- Phase 5: money after capture. Effective-dated commission rules and finance settings, a balanced
-- append-only ledger, merchant earnings with payout eligibility, refunds with a two-approver
-- threshold, disputes, payout holds, payouts through the provider adapter and daily
-- reconciliation against the provider's records. Forward-only.
--
-- Invariants enforced here rather than only in code (docs/06-architecture-data.md):
--   * every ledger transaction balances (debits = credits), checked when the transaction commits;
--   * ledger rows, fee rules and finance settings are append-only: corrections are new rows;
--   * one ledger transaction per (kind, source), so a replayed webhook never posts twice (T06);
--   * refunds of a payment never add up to more than was captured (T09);
--   * a refund request is approved by someone other than its requester (T16);
--   * one earning per merchant suborder or booking, and one payout per earning.

-- ---------------------------------------------------------------------------------------------
-- Commission rules (docs/01-product.md: configurable, no fixed rate assumed). A merchant rule
-- beats the platform rule for the same mode; the latest rule effective at the time of capture
-- applies and its rate is copied onto the earning.
CREATE TABLE fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('shop', 'services')),
  business_id uuid REFERENCES businesses (id),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  effective_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_by uuid REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (mode, business_id, effective_at)
);
CREATE INDEX fee_rules_lookup_idx ON fee_rules (mode, business_id, effective_at DESC);
CREATE TRIGGER fee_rules_append_only BEFORE UPDATE OR DELETE ON fee_rules
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- Finance settings, versioned and effective-dated like fee rules (docs/04-admin.md).
CREATE TABLE finance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL CHECK (key IN (
    'refund_approval_threshold_fils', 'payout_dispute_window_days', 'payout_minimum_fils')),
  value integer NOT NULL CHECK (value >= 0),
  effective_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_by uuid REFERENCES admin_accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, effective_at)
);
CREATE TRIGGER finance_settings_append_only BEFORE UPDATE OR DELETE ON finance_settings
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- ---------------------------------------------------------------------------------------------
-- Payouts to merchants through the provider. pending -> paid | failed.
CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  amount_fils integer NOT NULL CHECK (amount_fils > 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  provider text NOT NULL CHECK (provider IN ('mock')),
  provider_ref text UNIQUE,
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) <= 100),
  needs_attention boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES admin_accounts (id),
  paid_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL)
);
CREATE INDEX payouts_business_idx ON payouts (business_id, created_at DESC, id);
CREATE TRIGGER payouts_updated_at BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- What each merchant earned from one paid suborder or prepaid booking. The ledger is the source
-- of truth for balances; earnings track eligibility and which payout settled them.
-- net = gross - commission - (refunded - commission_refunded).
ALTER TABLE merchant_orders ADD COLUMN delivered_at timestamptz;

CREATE TABLE merchant_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  source_type text NOT NULL CHECK (source_type IN ('merchant_order', 'booking')),
  merchant_order_id uuid UNIQUE,
  booking_id uuid UNIQUE REFERENCES bookings (id),
  payment_id uuid NOT NULL REFERENCES payments (id),
  mode text NOT NULL CHECK (mode IN ('shop', 'services')),
  gross_fils integer NOT NULL CHECK (gross_fils > 0),
  commission_base_fils integer NOT NULL CHECK (commission_base_fils BETWEEN 0 AND gross_fils),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  fee_rule_id uuid REFERENCES fee_rules (id),
  commission_fils integer NOT NULL CHECK (commission_fils BETWEEN 0 AND commission_base_fils),
  refunded_fils integer NOT NULL DEFAULT 0 CHECK (refunded_fils BETWEEN 0 AND gross_fils),
  commission_refunded_fils integer NOT NULL DEFAULT 0
    CHECK (commission_refunded_fils BETWEEN 0 AND commission_fils),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'eligible', 'in_payout', 'paid_out')),
  eligible_at timestamptz,
  payout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_order_id, business_id) REFERENCES merchant_orders (id, business_id),
  FOREIGN KEY (payout_id, business_id) REFERENCES payouts (id, business_id),
  CHECK ((source_type = 'merchant_order') = (merchant_order_id IS NOT NULL)),
  CHECK ((source_type = 'booking') = (booking_id IS NOT NULL)),
  CHECK (status NOT IN ('in_payout', 'paid_out') OR payout_id IS NOT NULL),
  CHECK (status <> 'eligible' OR eligible_at IS NOT NULL)
);
CREATE INDEX merchant_earnings_business_idx ON merchant_earnings (business_id, status, created_at);
CREATE TRIGGER merchant_earnings_updated_at BEFORE UPDATE ON merchant_earnings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Ledger. Accounts:
--   psp_clearing          money held for the platform at the provider (asset)
--   merchant_payable      owed to one business (liability, per business)
--   payouts_in_transit    sent to the provider for payout, not yet confirmed (per business)
--   platform_commission   platform revenue
--   unallocated_receipts  late payments waiting for their automatic refund
CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'capture', 'late_capture', 'refund', 'late_refund', 'chargeback',
    'payout_initiated', 'payout_paid', 'payout_failed')),
  source_type text NOT NULL CHECK (source_type IN (
    'merchant_earning', 'payment', 'refund', 'dispute', 'payout')),
  source_id uuid NOT NULL,
  business_id uuid REFERENCES businesses (id),
  memo text CHECK (memo IS NULL OR length(memo) <= 500),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_type, source_id)
);
CREATE INDEX ledger_transactions_business_idx ON ledger_transactions (business_id, occurred_at DESC);

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions (id),
  account text NOT NULL CHECK (account IN (
    'psp_clearing', 'merchant_payable', 'payouts_in_transit', 'platform_commission',
    'unallocated_receipts')),
  business_id uuid REFERENCES businesses (id),
  debit_fils integer NOT NULL DEFAULT 0 CHECK (debit_fils >= 0),
  credit_fils integer NOT NULL DEFAULT 0 CHECK (credit_fils >= 0),
  currency text NOT NULL DEFAULT 'AED' CHECK (currency = 'AED'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_fils > 0) <> (credit_fils > 0)),
  CHECK ((account IN ('merchant_payable', 'payouts_in_transit')) = (business_id IS NOT NULL))
);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries (transaction_id);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account, business_id);
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION append_only();

-- Debits must equal credits for every ledger transaction, checked at commit so a transaction can
-- insert its entries one by one (docs/06-architecture-data.md: deferred validation).
CREATE FUNCTION ledger_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d bigint;
  c bigint;
  n integer;
BEGIN
  SELECT coalesce(sum(debit_fils), 0), coalesce(sum(credit_fils), 0), count(*)
    INTO d, c, n
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced (debits %, credits %)',
      NEW.transaction_id, d, c USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transaction_balanced();

-- ---------------------------------------------------------------------------------------------
-- Refund requests from the admin console. Above the threshold in force when requested, a second
-- admin must approve (T16); the requester can never approve their own request.
CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments (id),
  merchant_order_id uuid REFERENCES merchant_orders (id),
  amount_fils integer NOT NULL CHECK (amount_fils > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  threshold_fils integer NOT NULL CHECK (threshold_fils >= 0),
  needs_second_approval boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'pending_approval', 'approved', 'rejected')),
  requested_by uuid NOT NULL REFERENCES admin_accounts (id),
  decided_by uuid REFERENCES admin_accounts (id),
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK ((status = 'pending_approval') = (decided_at IS NULL))
);
CREATE INDEX refund_requests_status_idx ON refund_requests (status, created_at DESC, id);
CREATE TRIGGER refund_requests_updated_at BEFORE UPDATE ON refund_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE refunds DROP CONSTRAINT refunds_reason_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_check CHECK (reason IN (
  'late_payment', 'customer_cancellation', 'business_cancellation', 'admin'));
ALTER TABLE refunds ADD COLUMN merchant_order_id uuid REFERENCES merchant_orders (id);
ALTER TABLE refunds ADD COLUMN refund_request_id uuid UNIQUE REFERENCES refund_requests (id);
ALTER TABLE refunds ADD CONSTRAINT refunds_admin_has_request
  CHECK ((reason = 'admin') = (refund_request_id IS NOT NULL));
ALTER TABLE payments ADD COLUMN reconciled_at timestamptz;

-- Refunds that are pending or succeeded never exceed the captured amount (T09). The payment row
-- is locked so two concurrent refunds cannot both pass the check.
CREATE FUNCTION refunds_within_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  captured integer;
  total bigint;
BEGIN
  IF NEW.status = 'failed' THEN
    RETURN NEW;
  END IF;
  SELECT amount_fils INTO captured FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  SELECT coalesce(sum(amount_fils), 0) INTO total
    FROM refunds
   WHERE payment_id = NEW.payment_id AND status <> 'failed' AND id <> NEW.id;
  IF total + NEW.amount_fils > captured THEN
    RAISE EXCEPTION 'refunds of payment % would exceed the captured amount', NEW.payment_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_within_capture';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER refunds_within_capture BEFORE INSERT OR UPDATE OF amount_fils, status ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_within_capture();

-- ---------------------------------------------------------------------------------------------
-- Disputes (chargebacks) on one earning. While open, that earning is not paid out (T09). A lost
-- dispute takes the amount back from the merchant and the platform's commission share.
CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id uuid NOT NULL REFERENCES merchant_earnings (id),
  business_id uuid NOT NULL REFERENCES businesses (id),
  amount_fils integer NOT NULL CHECK (amount_fils > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  opened_by uuid NOT NULL REFERENCES admin_accounts (id),
  resolved_by uuid REFERENCES admin_accounts (id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX disputes_one_open_per_earning ON disputes (earning_id) WHERE status = 'open';
CREATE TRIGGER disputes_updated_at BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Payout holds on a business (compliance or finance concern). Released, never deleted.
CREATE TABLE payout_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  placed_by uuid NOT NULL REFERENCES admin_accounts (id),
  released_by uuid REFERENCES admin_accounts (id),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((released_by IS NULL) = (released_at IS NULL))
);
CREATE UNIQUE INDEX payout_holds_one_active ON payout_holds (business_id) WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Reconciliation against the provider's records, one run per provider and period (T15).
CREATE TABLE reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('mock')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  checked_count integer NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  recovered_count integer NOT NULL DEFAULT 0 CHECK (recovered_count >= 0),
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  started_by uuid REFERENCES admin_accounts (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  failure text CHECK (failure IS NULL OR length(failure) <= 500),
  UNIQUE (provider, period_start),
  CHECK (period_end > period_start)
);

CREATE TABLE reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES reconciliation_runs (id),
  kind text NOT NULL CHECK (kind IN (
    'recovered_missing_webhook', 'amount_mismatch', 'status_mismatch', 'unknown_at_provider',
    'unknown_locally')),
  object_type text NOT NULL CHECK (object_type IN ('payment', 'refund', 'payout')),
  provider_ref text CHECK (provider_ref IS NULL OR length(provider_ref) <= 200),
  payment_id uuid REFERENCES payments (id),
  refund_id uuid REFERENCES refunds (id),
  payout_id uuid REFERENCES payouts (id),
  local_amount_fils integer,
  provider_amount_fils integer,
  local_status text,
  provider_status text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES admin_accounts (id),
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Findings settled automatically (a replayed webhook) are resolved with no admin.
  CHECK (resolved_by IS NULL OR resolved_at IS NOT NULL)
);
CREATE INDEX reconciliation_items_open_idx ON reconciliation_items (created_at DESC)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Makes earnings eligible for payout once the work is done and the dispute window has passed
-- (docs/05-workflows.md, payouts): a booking completed, marked no-show or canceled with money
-- kept; a suborder delivered (phase 6 sets delivered_at). Called by the worker and before each
-- payout run. Returns how many earnings became eligible.
CREATE FUNCTION mark_earnings_eligible(p_now timestamptz, p_window_days integer)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  WITH done AS (
    SELECT e.id,
           coalesce(b.completed_at, b.no_show_at, b.canceled_at, mo.delivered_at) AS done_at
      FROM merchant_earnings e
      LEFT JOIN bookings b ON b.id = e.booking_id
      LEFT JOIN merchant_orders mo ON mo.id = e.merchant_order_id
     WHERE e.status = 'pending'
       AND ((b.id IS NOT NULL AND b.status IN ('completed', 'no_show', 'canceled'))
         OR (mo.id IS NOT NULL AND mo.status = 'delivered' AND mo.delivered_at IS NOT NULL))
  )
  UPDATE merchant_earnings e
     SET status = 'eligible', eligible_at = done.done_at + make_interval(days => p_window_days)
    FROM done
   WHERE e.id = done.id
     AND done.done_at + make_interval(days => p_window_days) <= p_now;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
