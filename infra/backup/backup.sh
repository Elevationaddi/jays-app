#!/usr/bin/env bash
# Encrypted logical backup of the database (docs/09-security-testing.md: backups encrypted,
# restoration tested). Writes <dir>/jays-<UTC timestamp>.dump.enc and a .sha256 next to it.
#
#   DATABASE_URL            source database (required)
#   BACKUP_DIR              output directory (default ./backups)
#   BACKUP_PASSPHRASE_FILE  file holding the encryption passphrase (required; keep it in the
#                           secret manager, never next to the backups)
#   PG_DUMP                 pg_dump command, matching the server's major version (default pg_dump)
#   BACKUP_METRICS_FILE     optional node_exporter textfile; on success it records
#                           jays_backup_last_success_timestamp_seconds for the BackupMissing alert
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE is required}"
[ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "passphrase file is empty or missing" >&2; exit 1; }
dir="${BACKUP_DIR:-./backups}"
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$dir/jays-$stamp.dump.enc"
umask 077
# A failed dump never leaves a file that looks like a backup.
trap 'status=$?; [ "$status" -eq 0 ] || rm -f "$out" "$out.sha256"' EXIT

# Custom format (compressed, restorable table by table), one consistent snapshot.
${PG_DUMP:-pg_dump} --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$out"

(cd "$dir" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
if [ -n "${BACKUP_METRICS_FILE:-}" ]; then
  tmp="$BACKUP_METRICS_FILE.tmp"
  {
    echo '# HELP jays_backup_last_success_timestamp_seconds When the last database backup finished.'
    echo '# TYPE jays_backup_last_success_timestamp_seconds gauge'
    echo "jays_backup_last_success_timestamp_seconds $(date -u +%s)"
    echo '# HELP jays_backup_last_size_bytes Size of the last encrypted backup.'
    echo '# TYPE jays_backup_last_size_bytes gauge'
    echo "jays_backup_last_size_bytes $(wc -c < "$out" | tr -d ' ')"
  } > "$tmp"
  mv "$tmp" "$BACKUP_METRICS_FILE"
fi
echo "$out"
