#!/bin/sh
# One-time setup of Garage (decision 249), after the first `docker compose
# up -d garage`: gives the single node its storage role, creates one
# bucket per environment and one key per user of it:
#   vgr-api-prod     read/write  vgr-media
#   vgr-api-homolog  read/write  vgr-media-homolog
#   vgr-backup       read        both (rclone, decision 244)
# Prints each key once — copy them into api-prod.env, api-homolog.env and
# rclone.conf. Run from deploy/:  sh garage/init.sh [capacity, e.g. 50G]
set -eu
CAPACITY="${1:-50G}"
garage() { docker compose exec -T -e RUST_LOG=warn garage /garage "$@"; }

NODE=$(garage node id -q | cut -d@ -f1)
garage layout assign -z dc1 -c "$CAPACITY" "$NODE"
garage layout apply --version 1

garage bucket create vgr-media
garage bucket create vgr-media-homolog

garage key create vgr-api-prod
garage bucket allow --read --write vgr-media --key vgr-api-prod
garage key create vgr-api-homolog
garage bucket allow --read --write vgr-media-homolog --key vgr-api-homolog
garage key create vgr-backup
garage bucket allow --read vgr-media --key vgr-backup
garage bucket allow --read vgr-media-homolog --key vgr-backup

echo
echo "Keys (shown once — store them in the env files, then clear the terminal):"
for k in vgr-api-prod vgr-api-homolog vgr-backup; do
  garage key info "$k" --show-secret | grep -E "Key name|Key ID|Secret key"
done
