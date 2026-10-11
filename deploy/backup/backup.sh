#!/usr/bin/env bash
# Daily backup (decision 244), run by the vgr-backup systemd timer.
#
# 1. One dump per database (vgr, vgr_homolog), gzip, encrypted with age to
#    the public key in $VGR_SECRETS_DIR/backup-recipients.txt. The private
#    key is NOT on the server: it lives with the offline copy of the master
#    keys (decision 243), so the server cannot read its own backups.
# 2. Each Garage bucket mirrored off the server with rclone. Objects are
#    already ciphertext (media envelope encryption, decision 126). An object
#    removed from Garage moves to removed/<day> on the mirror.
# 3. The dumps copied off the server.
# 4. Anything older than $RETENTION_DAYS (30) deleted, here and off the
#    server. This is the real deletion deadline of decision 244: crypto-
#    shredding clears a key in the database, but a dump taken before still
#    has it until the dump expires.
#
# Off-server destination: the `offsite` remote of rclone.conf (provider is a
# commercial choice); reading Garage: the `garage` remote with the read-only
# vgr-backup key. See docs/adr/DEPLOY.md.
set -euo pipefail

cd "$(dirname "$0")/.."    # deploy/
set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a

SECRETS="${VGR_SECRETS_DIR:-/etc/vgr}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vgr}"
OFFSITE_PATH="${OFFSITE_PATH:-vgr-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RECIPIENTS="$SECRETS/backup-recipients.txt"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DAY="$(date -u +%F)"
CUTOFF="$(date -u -d "-$RETENTION_DAYS days" +%F)"

[ -s "$RECIPIENTS" ] || { echo "missing $RECIPIENTS (age public key)" >&2; exit 1; }
command -v age >/dev/null || { echo "age is not installed" >&2; exit 1; }

# rclone runs in the compose `rclone` service: it reaches Garage on the
# internal network and the off-server remote on the edge one.
rc() { docker compose --profile tools run --rm -T rclone "$@" </dev/null; }

umask 077
mkdir -p "$BACKUP_DIR/db"

echo "[backup] databases"
for db in vgr vgr_homolog; do
  out="$BACKUP_DIR/db/$db-$STAMP.sql.gz.age"
  # The root password stays inside the container (mariadb.env).
  docker compose exec -T mariadb sh -c \
    'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers --hex-blob "$1"' \
    sh "$db" | gzip -9 | age -R "$RECIPIENTS" > "$out.part"
  mv "$out.part" "$out"
  echo "  $out ($(stat -c %s "$out") bytes)"
done

echo "[backup] media"
for bucket in vgr-media vgr-media-homolog; do
  rc sync "garage:$bucket" "offsite:$OFFSITE_PATH/media/$bucket/current" \
    --backup-dir "offsite:$OFFSITE_PATH/media/$bucket/removed/$DAY"
done

echo "[backup] off-server copy of the dumps"
rc copy /backups/db "offsite:$OFFSITE_PATH/db"

echo "[backup] retention: $RETENTION_DAYS days (before $CUTOFF)"
find "$BACKUP_DIR/db" -name '*.sql.gz.age' -mtime "+$RETENTION_DAYS" -delete
rc delete --min-age "${RETENTION_DAYS}d" "offsite:$OFFSITE_PATH/db"
# Removed objects keep their original dates, so they expire by the day
# they were removed (the folder name), not by their own age.
for bucket in vgr-media vgr-media-homolog; do
  for dir in $(rc lsf --dirs-only "offsite:$OFFSITE_PATH/media/$bucket/removed" 2>/dev/null || true); do
    dir="${dir%/}"
    if [[ "$dir" < "$CUTOFF" ]]; then
      rc purge "offsite:$OFFSITE_PATH/media/$bucket/removed/$dir"
      echo "  purged $bucket/removed/$dir"
    fi
  done
done

# Optional dead man's switch: a service that alerts when this ping stops
# arriving (same alerting as decision 245).
if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" >/dev/null
fi
echo "[backup] done $STAMP"
