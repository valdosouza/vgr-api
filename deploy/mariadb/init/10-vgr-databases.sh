#!/bin/sh
# Runs once, when the MariaDB data directory is empty (official image
# entrypoint). One database and one user per environment (decision 242):
# the staging API cannot read production data. Passwords come from
# mariadb.env — generate them with `openssl rand -hex 24` (no quotes in
# them, they are interpolated into SQL below).
set -eu
: "${VGR_DB_PASSWORD:?missing in mariadb.env}"
: "${VGR_HOMOLOG_DB_PASSWORD:?missing in mariadb.env}"

mariadb --protocol=socket -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS vgr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS vgr_homolog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'vgr'@'%' IDENTIFIED BY '${VGR_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'vgr_homolog'@'%' IDENTIFIED BY '${VGR_HOMOLOG_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON vgr.* TO 'vgr'@'%';
GRANT ALL PRIVILEGES ON vgr_homolog.* TO 'vgr_homolog'@'%';
FLUSH PRIVILEGES;
SQL
