#!/usr/bin/env bash
# Encrypted logical backup of the database (docs/09-security-testing.md: backups encrypted,
# restoration tested). Writes <dir>/jays-<UTC timestamp>.dump.age (or .dump.enc) and a .sha256.
#
#   DATABASE_URL            source database (required)
#   BACKUP_DIR              output directory (default ./backups)
#   BACKUP_AGE_RECIPIENT    an age public key (age1...). Preferred (ADR-0037): the machine that makes
#                           backups holds only the public key and cannot decrypt them; the private
#                           key stays offline with the founder. Writes .dump.age.
#   BACKUP_PASSPHRASE_FILE  or: a file holding a symmetric passphrase (openssl AES-256, .dump.enc);
#                           keep it in the secret manager, never next to the backups
#   PG_DUMP                 pg_dump command, matching the server's major version (default pg_dump)
#   BACKUP_METRICS_FILE     optional node_exporter textfile; on success it records
#                           jays_backup_last_success_timestamp_seconds for the BackupMissing alert
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
dir="${BACKUP_DIR:-./backups}"
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must be an age public key" >&2; exit 1 ;; esac
  out="$dir/jays-$stamp.dump.age"
  encrypt() { age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$out"; }
else
  : "${BACKUP_PASSPHRASE_FILE:?BACKUP_AGE_RECIPIENT or BACKUP_PASSPHRASE_FILE is required}"
  [ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "passphrase file is empty or missing" >&2; exit 1; }
  out="$dir/jays-$stamp.dump.enc"
  encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$out"; }
fi
umask 077
# A failed dump never leaves a file that looks like a backup.
trap 'status=$?; [ "$status" -eq 0 ] || rm -f "$out" "$out.sha256"' EXIT

# Custom format (compressed, restorable table by table), one consistent snapshot.
${PG_DUMP:-pg_dump} --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" | encrypt

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
