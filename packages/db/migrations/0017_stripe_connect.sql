-- Phase 9.1: Stripe Connect in test mode (ADR-0030).
--
--   1. The provider columns accept 'stripe' as well as 'mock'.
--   2. Each business can have one connected payout account at the provider. Payouts with a real
--      provider go only to a business whose account the provider reports as able to receive them.

-- 1. Providers.
ALTER TABLE payments DROP CONSTRAINT payments_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('mock', 'stripe'));
ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_provider_check;
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_provider_check
  CHECK (provider IN ('mock', 'stripe'));
ALTER TABLE payouts DROP CONSTRAINT payouts_provider_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_provider_check CHECK (provider IN ('mock', 'stripe'));
ALTER TABLE reconciliation_runs DROP CONSTRAINT reconciliation_runs_provider_check;
ALTER TABLE reconciliation_runs ADD CONSTRAINT reconciliation_runs_provider_check
  CHECK (provider IN ('mock', 'stripe'));

-- 2. Connected payout accounts. Only the provider's account id and the flags it reports are kept:
--    bank details and identity documents stay with the provider.
ALTER TABLE businesses ADD COLUMN psp_account_id text UNIQUE
  CHECK (psp_account_id IS NULL OR psp_account_id ~ '^acct_[A-Za-z0-9_]{1,100}$');
ALTER TABLE businesses ADD COLUMN psp_account_provider text
  CHECK (psp_account_provider IS NULL OR psp_account_provider IN ('mock', 'stripe'));
ALTER TABLE businesses ADD COLUMN psp_details_submitted boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN psp_payouts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN psp_account_updated_at timestamptz;
ALTER TABLE businesses ADD CONSTRAINT businesses_psp_account_check
  CHECK ((psp_account_id IS NULL) = (psp_account_provider IS NULL));
