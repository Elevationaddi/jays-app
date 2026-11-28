#!/usr/bin/env bash
# Restores an encrypted backup into an EMPTY database. It refuses a database that already has
# tables, so a restore can never overwrite live data by mistake.
#
#   restore.sh <backup.dump.enc>
#   TARGET_DATABASE_URL     empty target database (required)
#   BACKUP_PASSPHRASE_FILE  passphrase used for the backup (required)
#   PG_RESTORE, PSQL        client commands matching the server's major version
set -euo pipefail

file="${1:?usage: restore.sh <backup.dump.enc>}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE is required}"
PSQL="${PSQL:-psql}"

if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256")
else
  echo "warning: no checksum file next to the backup" >&2
fi

tables="$($PSQL "$TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [ "$tables" != "0" ]; then
  echo "refusing to restore: the target database already has $tables tables" >&2
  exit 1
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$file" |
  ${PG_RESTORE:-pg_restore} --no-owner --no-privileges --exit-on-error --single-transaction \
    --dbname="$TARGET_DATABASE_URL"
echo "restored $(basename "$file")"
