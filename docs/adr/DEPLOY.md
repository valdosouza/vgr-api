# Deploying VGR (runbook)

Round 22 (`AI/docs/plans/plano-producao.md`), decisions 240-249: one
server in Brazil, Docker Compose, production and staging (homologação) on
the same machine, Garage as object store. Everything referenced here lives
in `deploy/` and was brought up end to end on 2026-10-10 (P2) — TLS, both
APIs, the panel, backup and restore.

```
                internet
                   │ 80/443
             ┌─────┴─────┐
             │   caddy   │  TLS (Let's Encrypt), HSTS, panel static files
             └─┬───────┬─┘
     api:3000  │       │  api-homolog:3000            ── edge network
         ┌─────┴─┐   ┌─┴───────────┐
         │  api  │   │ api-homolog │  same image, separate env files
         └───┬───┘   └──────┬──────┘
             │              │                        ── backend (internal, no internet)
       ┌─────┴──────────────┴─────┐
       │ mariadb: vgr, vgr_homolog│   one user per database
       │ garage: vgr-media,        │   one key per bucket
       │         vgr-media-homolog │
       └───────────────────────────┘
```

## 1. Before you start

- **Server**: Ubuntu 24.04 LTS in a Brazilian region (decision 240), at
  least 2 vCPU, 4 GB RAM, 80 GB disk. SSH by key only.
- **Domain** (round 22 item 4, still open) with four names pointing at the
  server: `api.`, `painel.`, `api-homolog.`, `painel-homolog.`.
- **Off-server storage** for backups (decision 244) — any rclone backend
  (S3-compatible bucket, Backblaze B2, SFTP…). Commercial choice.
- **SMTP sender** for e-mail verification and password recovery
  (decision 247). Commercial choice.
- **Uptime monitor** that can alert by e-mail or WhatsApp (decision 245).
- **Google OAuth Web clients**, one per environment, if Google login is on.

## 2. Prepare the server

```sh
apt update && apt install -y docker.io docker-compose-v2 age git ufw unattended-upgrades
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable

# Logs: 14 days (decision 245)
mkdir -p /etc/systemd/journald.conf.d
# (after cloning, step 3)  cp deploy/journald/vgr.conf /etc/systemd/journald.conf.d/
systemctl restart systemd-journald

install -d -m 700 /etc/vgr                 # secrets (decision 243)
install -d -m 700 /var/backups/vgr
install -d /srv/vgr/panel/prod /srv/vgr/panel/homolog
```

## 3. Code

```sh
install -d /opt/vgr && cd /opt/vgr
git clone https://github.com/valdosouza/vgr-api.git
cd vgr-api/deploy
cp .env.example .env        # host names + e-mail for the certificates
cp journald/vgr.conf /etc/systemd/journald.conf.d/ && systemctl restart systemd-journald
```

## 4. Secrets (decision 243)

Every file in `/etc/vgr` is `chmod 600`, owner root. Templates:
`deploy/env/*.example`.

```sh
umask 077
cp env/mariadb.env.example /etc/vgr/mariadb.env      # 3 × openssl rand -hex 24
cp env/garage.env.example  /etc/vgr/garage.env       # 2 × openssl rand -hex 32
cp env/api.env.example /etc/vgr/api-prod.env
cp env/api.env.example /etc/vgr/api-homolog.env
```

Fill `api-prod.env` and `api-homolog.env` with **different** values: own
database user and password, own bucket, own `JWT_SECRET`, `LEGAL_KEK`,
`MEDIA_KEK` (generator in the template), own `CORS_ORIGIN`.

Backup key pair (decision 244) — the server only ever holds the public
half:

```sh
age-keygen -o backup-identity.txt          # on a trusted machine, not the server
age-keygen -y backup-identity.txt > /etc/vgr/backup-recipients.txt
```

**Offline vault, before the first boot** (decision 243, two people with
access): `LEGAL_KEK` and `MEDIA_KEK` of each environment, the backup
`backup-identity.txt`, and later the Android upload key. Losing a KEK loses
everything it encrypted; losing the backup identity makes every backup
unreadable.

## 5. First start

```sh
cd /opt/vgr/vgr-api/deploy
docker compose up -d mariadb garage
sh garage/init.sh 50G        # prints three keys once
```

Copy the keys: `vgr-api-prod` → `S3_ACCESS_KEY`/`S3_SECRET_KEY` of
`api-prod.env`; `vgr-api-homolog` → `api-homolog.env`; `vgr-backup` →
`rclone.conf` (section 8). Then:

```sh
docker compose build api-homolog
docker tag vgr-api:homolog vgr-api:prod
docker compose up -d
docker compose ps            # api and api-homolog: (healthy)
```

Each API applies its migrations on boot and refuses to start without them
(`RELEASE.md`). `curl https://api.<domain>/health` → `{"status":"ok"}`.

## 6. First panel account, per environment

The password goes on the command line — keep it out of the shell history
(leading space, with `HISTCONTROL=ignorespace`, the Ubuntu default):

```sh
 docker compose exec api         node dist/cli/seed-admin.js <email> '<password>'
 docker compose exec api-homolog node dist/cli/seed-admin.js <email> '<password>'
```

Log in on the panel and enroll 2FA (mandatory, decision 114).

## 7. The panel

Built on a development machine for each environment
(`vgr-app/docs/feature/release.md`), then copied:

```sh
flutter build web --release --no-web-resources-cdn --dart-define=API_URL=https://api.<domain>
rsync -a --delete build/web/ root@server:/srv/vgr/panel/prod/
```

Caddy serves it at `https://painel.<domain>`; the entry files are never
cached, so the new build takes effect on the next load.

**Legal Gate**: with `LEGAL_JURISDICTION=BR` every gated feature answers
451 until a rule for it is active (decisions 104, 79). The rules are
created and approved in the panel's Legal Gate screens.

## 8. Backups (decision 244)

`/etc/vgr/rclone.conf` (chmod 600):

```ini
[garage]
type = s3
provider = Other
endpoint = http://garage:3900
region = garage
force_path_style = true
access_key_id = <vgr-backup key id>
secret_access_key = <vgr-backup secret>

[offsite]
# the chosen provider — `rclone config` on any machine generates this block
```

```sh
cp systemd/vgr-backup.service systemd/vgr-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vgr-backup.timer
systemctl start vgr-backup.service && journalctl -u vgr-backup -n 30
```

Daily at 03:30 Brasília: encrypted dump of each database, media mirrored,
everything off the server, then anything older than 30 days deleted —
which makes 30 days the real deadline for deleted data (decision 244).
Optional: `BACKUP_PING_URL` in `deploy/.env` (a dead man's switch that
alerts when a day's backup does not report).

**Restore test — mandatory before opening** (decision 244). Bring
`backup-identity.txt` from the vault for this run only:

```sh
backup/restore.sh /var/backups/vgr/db/vgr-<stamp>.sql.gz.age vgr_restore_test ./backup-identity.txt
# compare "tables" and "migrations" with the live database, then:
docker compose exec mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE vgr_restore_test"'
shred -u ./backup-identity.txt
```

Restoring over a live database needs `--into-live` and the API of that
environment stopped. Media comes back with rclone using a **read/write**
key of that bucket (the backup key is read-only):
`docker compose --profile tools run --rm rclone copy offsite:vgr-backups/media/vgr-media/current <remote-with-rw-key>:vgr-media`.

## 9. Monitoring (decision 245)

- External check every minute of `https://api.<domain>/health` and
  `https://api-homolog.<domain>/health`. It answers 503 when the database
  does not respond, so one check covers both.
- Logs: `journalctl -t vgr/vgr-api-1 -f` (or `docker compose logs -f api`).
  Kept 14 days.

## 10. Updates — staging first (decision 242)

```sh
cd /opt/vgr/vgr-api && git pull
cd deploy && docker compose build api-homolog && docker compose up -d api-homolog
# test on painel-homolog / the staging app, then promote the SAME image:
docker tag vgr-api:prod vgr-api:prod-previous
docker tag vgr-api:homolog vgr-api:prod
docker compose up -d api
```

Rollback: `docker tag vgr-api:prod-previous vgr-api:prod && docker compose up -d api`.
Migrations only go forward: if the release that is being rolled back
migrated the database, the previous image may not run on it — restore the
dump taken before the update instead (run `systemctl start vgr-backup`
before every production update).

Base images (`caddy`, `mariadb`, `garage`, `rclone`) are pinned in
`compose.yaml`; review their releases monthly, bump, `docker compose pull`,
`docker compose up -d`.
