-- Phase 10: Vercel deployment (ADR-0033).
--
-- Request rate limits counted in PostgreSQL, so the API needs no Redis subscription on Vercel.
-- Fixed windows, one row per rule and subject, updated with a single atomic upsert. UNLOGGED:
-- counters are not worth WAL or replication, and losing them in a crash only resets the windows.
CREATE UNLOGGED TABLE rate_limit_counters (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 512),
  count integer NOT NULL CHECK (count >= 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limit_counters_reset_idx ON rate_limit_counters (reset_at);
