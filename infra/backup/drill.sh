#!/usr/bin/env bash
# Restore drill (T12): back up the source, restore it into a scratch database, and prove the
# copy is complete and consistent. Run in CI on every change and on a schedule in production.
#
#   DATABASE_URL   source database (required)
#   ADMIN_URL      a database on the same server used to create/drop the scratch database
#                  (default: DATABASE_URL with the database name replaced by "postgres")
#   PG_DUMP, PG_RESTORE, PSQL   client commands matching the server's major version
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
here="$(cd "$(dirname "$0")" && pwd)"
PSQL="${PSQL:-psql}"
base="${DATABASE_URL%/*}"
admin="${ADMIN_URL:-$base/postgres}"
scratch="jays_restore_drill_$$"
target="$base/$scratch"
work="$(mktemp -d)"
trap '$PSQL "$admin" -qc "DROP DATABASE IF EXISTS $scratch" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

# A throwaway passphrase: the drill tests encryption and decryption, not key custody.
openssl rand -hex 32 > "$work/passphrase"
export BACKUP_PASSPHRASE_FILE="$work/passphrase"

file="$(BACKUP_DIR="$work" "$here/backup.sh")"
echo "backup: $(basename "$file") ($(du -h "$file" | cut -f1))"
$PSQL "$admin" -qc "CREATE DATABASE $scratch"
TARGET_DATABASE_URL="$target" "$here/restore.sh" "$file"

# Exact row count of every table, compared side by side.
counts() {
  $PSQL "$1" -tAc "
    SELECT string_agg(t || '=' || n, E'\n' ORDER BY t) FROM (
      SELECT table_name AS t,
             (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text AS n
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE') s"
}
counts "$DATABASE_URL" > "$work/source.txt"
counts "$target" > "$work/restored.txt"
if ! diff -u "$work/source.txt" "$work/restored.txt"; then
  echo "FAIL: row counts differ" >&2
  exit 1
fi
echo "tables compared: $(wc -l < "$work/source.txt")"

# The restored copy must keep its invariants: same migrations, a balanced ledger, and the
# append-only triggers still refusing edits.
check() {
  local label="$1" sql="$2" want="$3" got
  got="$($PSQL "$target" -tAc "$sql")"
  if [ "$got" != "$want" ]; then echo "FAIL: $label (got $got, want $want)" >&2; exit 1; fi
  echo "ok: $label"
}
migrations="$($PSQL "$DATABASE_URL" -tAc "SELECT string_agg(name, ',' ORDER BY name) FROM schema_migrations")"
check "migrations match" "SELECT string_agg(name, ',' ORDER BY name) FROM schema_migrations" "$migrations"
check "ledger balanced" "SELECT count(*) FROM (SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING sum(debit_fils) <> sum(credit_fils)) t" "0"
check "append-only triggers present" "SELECT count(*) > 0 FROM pg_trigger WHERE tgname LIKE '%append_only%'" "t"
echo "restore drill passed"
