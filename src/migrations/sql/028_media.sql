-- Media storage index (decisions 126-132, plano-imagens.md). The binary
-- NEVER lives here: objects go to the BlobStore (MinIO/S3-compatible,
-- decision 126) as ciphertext; this table is the single index — nothing is
-- ever discovered by scanning storage (plan §3, rule 4).
--
-- Encryption: one DEK per media, wrapped by MEDIA_KEK (envelope pattern of
-- decision 111, key deliberately separate from LEGAL_KEK). Deleting media
-- is crypto-shredding: destroy the wrapped DEK and the object is
-- unrecoverable even in backups (decision 131 / plan §7).

CREATE TABLE IF NOT EXISTS tb_media (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  -- Route identifier. Random on purpose: media ids are not enumerable.
  public_id           CHAR(36) NOT NULL UNIQUE,
  -- 'avatar' exists in the schema but is OFF in the MVP (decision 127).
  class               VARCHAR(10) NOT NULL DEFAULT 'evidence',
  -- Null = anonymous upload (decisions 32/35): reporting with photos never
  -- requires an account. The anonymous trail is the accountability log,
  -- wired when the report references this row (M2).
  uploader_account_id INT NULL,
  -- pending -> available -> blocked (moderation hold, kept for authority)
  --                      -> deleted (crypto-shredded)
  status              VARCHAR(10) NOT NULL DEFAULT 'pending',
  -- What arrived vs what we serve. Everything served is the re-encoded
  -- output of the ingest pipeline — EXIF never survives (plan §4).
  mime_original       VARCHAR(30) NOT NULL,
  mime                VARCHAR(30) NOT NULL,
  bytes_original      INT NOT NULL,
  bytes               INT NOT NULL,
  width               INT NOT NULL,
  height              INT NOT NULL,
  -- Chain of custody: hash of the exact bytes received (recorded even when
  -- the original is discarded) and of the normalized output (dedup).
  sha256_original     CHAR(64) NOT NULL,
  sha256              CHAR(64) NOT NULL,
  -- Random storage prefix — object keys are <ab>/<prefix>/<variant> and
  -- never contain user/report/date (plan §3, rule 3). Distinct from
  -- public_id so the route id reveals nothing about storage layout.
  storage_prefix      CHAR(36) NOT NULL,
  -- Decision 130: keeping the EXIF original is the reporter's explicit
  -- per-photo choice (default discard). When kept, the 'original' variant
  -- exists in storage (encrypted) and only the audited panel reads it.
  keep_original       CHAR(1) NOT NULL DEFAULT 'N',
  -- Version of the warning text shown at the moment of choice (pattern of
  -- decision 86 — the choice is proof only with the text that produced it).
  exif_warning_version VARCHAR(20) NULL,
  -- v1.k<kekVersion>.<iv>.<tag>.<wrapped> — DEK wrapped by MEDIA_KEK.
  -- NULL after crypto-shredding (decision 131): that IS the deletion.
  dek_wrapped         VARCHAR(255) NULL,
  -- Retention (decision 131): filled when the owning case resolves
  -- (M2/M3); frozen = case escalated to an authority, never expires until
  -- unfrozen (Legal Gate frozen-data mechanism).
  expires_at          DATETIME NULL,
  frozen              CHAR(1) NOT NULL DEFAULT 'N',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted             CHAR(1) NOT NULL DEFAULT 'N',
  KEY idx_media_uploader (uploader_account_id),
  KEY idx_media_status (status),
  KEY idx_media_expires (expires_at),
  CONSTRAINT fk_media_uploader FOREIGN KEY (uploader_account_id)
    REFERENCES tb_user_account (id),
  CONSTRAINT chk_media_class CHECK (class IN ('evidence', 'avatar')),
  CONSTRAINT chk_media_status CHECK (status IN ('pending', 'available', 'blocked', 'deleted'))
);
