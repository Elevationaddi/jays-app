-- Baseline extensions. Forward-only; never edit an applied migration (the runner checks checksums).
--
-- pgcrypto:  gen_random_uuid() for UUID primary keys (docs/06-architecture-data.md).
-- citext:    case-insensitive unique email addresses (phase 1).
-- btree_gist: exclusion constraints combining equality on staff_id with tstzrange overlap,
--            which is how double booking is prevented at the database level (phase 4).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
