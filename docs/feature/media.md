# Media (images) — M1 foundation

Decisions 126–132 (`AI/docs/decisions/VGR-plano.md`); strategy in
`AI/docs/plans/plano-imagens.md`. M1 ships the foundation: ingest pipeline,
encrypted storage behind a port, and the app-plane routes. Report
integration (M2) and retention jobs / panel access (M3) are NOT built.

## Routes (app plane, mounted at `/app-media` — outside `/api`)

| Route | Auth | Purpose |
|---|---|---|
| `POST /app-media` | optional (anonymous allowed — decisions 32/35) | multipart upload, field `file` + text fields `class`, `keepOriginal`, `exifWarningVersion` |
| `GET /app-media/:publicId/:variant?` | app token required | streams an OWNED variant (`normalized` default, `thumb`, `blur`) |

- Upload never blocks a report (decision 123): the app submits the report
  first and pushes attachments from the offline queue (decision 28).
- `class=avatar` answers 422 `NOT_AVAILABLE` while decision 127 keeps the
  class off (`AVATAR_ENABLED=false`).
- Reads answer **404 for everything that must not be served** (missing,
  other owner, anonymous-owned, blocked, shredded, `original`) — never 403:
  existence is information.
- Anonymous-owned media cannot be read back on this route; it is served
  through its report once M2 wires the reference.

## Ingest pipeline (`media.service.ingest`)

1. Magic-byte sniffing (`image/jpeg|png|webp`) — the client Content-Type is
   never consulted. **HEIC**: the prebuilt sharp binary has no HEIF decoder
   (patent licensing), so the app converts HEIC→JPEG at capture.
   *Amendment note vs decision 129's wording (“heic na entrada”): accepted
   at capture on the client, not on the wire — same user-visible result.*
2. SHA-256 of the received bytes (chain of custody, recorded always).
3. **Re-encode** (sharp): `.rotate()` (applies EXIF orientation) → resize
   cap 2048 → webp q80. Output has NO metadata — EXIF/GPS never survives
   (asset #1 of the security plan). Derivatives: `thumb` (320) and `blur`
   (320, blurred at ingest — decision 128: the sharp thumbnail never
   reaches a client to be "un-blurred").
4. `keepOriginal=true` (decision 130, per-photo, default false): requires
   `exifWarningVersion` (decision 86 pattern); stores the byte-exact
   original **encrypted** as the `original` variant — panel-only, audited
   (M3); the app never streams it.
5. Envelope encryption: one DEK per media (AES-256-GCM), wrapped by
   **MEDIA_KEK** (separate from LEGAL_KEK). Object body =
   `iv(12)‖tag(16)‖ciphertext`; wrapped DEK lives in `tb_media.dek_wrapped`.
   Crypto-shredding (`repository.shred`) clears that column: the objects
   become unrecoverable noise, backups included (decision 131).

## Storage (`@shared/storage`)

`BlobStore` port (decision 126, PaymentRail pattern of decision 96):
`put/get/delete`, backend picked by `BLOB_STORE`:

- `fs` — local disk (dev/test), root `MEDIA_FS_ROOT`.
- `s3` — any S3-compatible endpoint via in-house SigV4 signer
  (`sigv4.ts`, tested against the AWS documentation vector). MinIO
  self-hosted in the MVP; the paid provider is the one open round-7 item.

Object keys: `<2-char shard>/<random uuid>/<variant>` — never contain user,
report or date (plan §3 rule 3). `tb_media` (migration 028) is the single
index; nothing scans storage.

## Env (see `.env.example`)

`MEDIA_KEK`(+`_VERSION`) — required in production (boot refuses without).
`BLOB_STORE`, `MEDIA_FS_ROOT`, `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY`
(all four required in production when `BLOB_STORE=s3`), `MEDIA_MAX_BYTES`
(10 MB default), `MEDIA_MAX_PER_REPORT` (10 — enforced in M2 when reports
reference media), `AVATAR_ENABLED` (decision 127, default off).

## Tests

`media-pipeline.spec` (EXIF stripped, format, caps, blur≠thumb),
`media.service.spec` (ciphertext on disk, decision-127/129/130 rules,
owner-only reads), `media.routes.spec` (anonymous multipart end-to-end),
`media-cipher.spec`, `sigv4.spec` (AWS vector), `fs-blob-store.spec`.
