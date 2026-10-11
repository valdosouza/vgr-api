#!/usr/bin/env bash
# Restores one encrypted dump (decision 244) into a database.
#
#   deploy/backup/restore.sh <dump.sql.gz.age> <target-database> <age-identity-file> [--into-live]
#
# The identity file is the backup PRIVATE key, brought from its offline
# copy for this run only — delete it afterwards. Default use is the restore
# test of decision 244: restore into a scratch database (e.g.
# vgr_restore_test), compare, drop it. Restoring over vgr or vgr_homolog
# replaces live data and needs --into-live (stop that environment's API
# first: `docker compose stop api`).
set -euo pipefail

cd "$(dirname "$0")/.."    # deploy/
DUMP="${1:?dump file}"
TARGET="${2:?target database}"
IDENTITY="${3:?age identity file}"
LIVE="${4:-}"

[[ "$TARGET" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid database name: $TARGET" >&2; exit 1; }
if [[ "$TARGET" == "vgr" || "$TARGET" == "vgr_homolog" ]] && [[ "$LIVE" != "--into-live" ]]; then
  echo "$TARGET is a live database — pass --into-live to overwrite it" >&2
  exit 1
fi

sql() { docker compose exec -T mariadb sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$@"' sh "$@"; }

sql -e "CREATE DATABASE IF NOT EXISTS \`$TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
age -d -i "$IDENTITY" "$DUMP" | gunzip | sql "$TARGET"

echo "Restored into $TARGET:"
sql -N -e "SELECT COUNT(*) AS tables_count FROM information_schema.tables WHERE table_schema = '$TARGET'" | sed 's/^/  tables: /'
sql -N "$TARGET" -e "SELECT COUNT(*), MAX(version) FROM _migrations" | awk '{print "  migrations: " $1 " (latest " $2 ")"}'
