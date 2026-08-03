-- App user authentication (decisions 119-124). Deliberately SEPARATE from
-- tb_user (the panel/team plane): different tables, different JWT audience,
-- cross-rejected in the middlewares. A weakness in the app plane must never
-- reach the panel that decrypts life-at-risk data (decision 119).
--
-- Amendment note: the tactical design's task 13 planned migration
-- `005_user_accounts.sql`; the number was taken long ago and the decisions
-- 119-124 rounds added providers, refresh tokens and 2FA to its scope.
-- Same table, same purpose, current number.

CREATE TABLE IF NOT EXISTS tb_user_account (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  display_name           VARCHAR(120) NOT NULL DEFAULT '',
  -- Nullable: an OTP-only account (decision 120) may never have an email.
  email                  VARCHAR(255) NULL UNIQUE,
  -- Decision 123 ("a denúncia nunca espera"): verification is NOT required
  -- to sign up or to report — only before consequential actions.
  email_verified         CHAR(1) NOT NULL DEFAULT 'N',
  phone                  VARCHAR(20) NULL UNIQUE,
  phone_verified         CHAR(1) NOT NULL DEFAULT 'N',
  -- Null on social-only accounts: they have no local password, which is
  -- why the password policy simply does not apply to them (decision 124).
  password_hash          VARCHAR(60) NULL,
  -- Decision 24: fixed BR in the MVP; the column exists so the Legal Gate
  -- has something to read when expansion happens (decisions 68/105).
  jurisdiction           VARCHAR(10) NOT NULL DEFAULT 'BR',
  -- Decision 8/task 13: registration does not complete without consent.
  consent_version        VARCHAR(20) NULL,
  consent_at            DATETIME NULL,
  -- Same revocation mechanism as the panel (decisions 112/122).
  session_version        INT NOT NULL DEFAULT 1,
  failed_login_count     INT NOT NULL DEFAULT 0,
  -- Optional TOTP for app users (decision 124) — envelope-encrypted like
  -- the panel's (decisions 44/111).
  totp_secret            TEXT NULL,
  totp_enabled           CHAR(1) NOT NULL DEFAULT 'N',
  active                 CHAR(1) NOT NULL DEFAULT 'S',
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted                CHAR(1) NOT NULL DEFAULT 'N'
);

-- One account, N providers (decision 119). The provider's `sub` is the
-- stable identity; email is stored only to support the linking rules of
-- decision 121. Nothing else from the profile is persisted — no photo, no
-- social graph, no contacts (minimization, decision 110).
CREATE TABLE IF NOT EXISTS tb_user_account_provider (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  tb_user_account_id INT NOT NULL,
  provider           VARCHAR(20) NOT NULL,
  provider_sub       VARCHAR(255) NOT NULL,
  email              VARCHAR(255) NULL,
  email_verified     CHAR(1) NOT NULL DEFAULT 'N',
  linked_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted            CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_provider_identity (provider, provider_sub),
  KEY idx_provider_account (tb_user_account_id),
  CONSTRAINT fk_provider_account FOREIGN KEY (tb_user_account_id)
    REFERENCES tb_user_account (id),
  CONSTRAINT chk_provider CHECK (provider IN ('google', 'apple', 'facebook', 'phone', 'password'))
);

-- Rotating refresh tokens (decision 122): 90 days, single use. Reusing a
-- rotated token revokes the whole FAMILY — that is the classic signal of a
-- stolen token, and the family id is what makes the blast radius the
-- device's session chain instead of one token.
CREATE TABLE IF NOT EXISTS tb_user_refresh_token (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  tb_user_account_id INT NOT NULL,
  family_id          CHAR(36) NOT NULL,
  -- SHA-256 of the token: the DB never holds anything usable as-is.
  token_hash         CHAR(64) NOT NULL UNIQUE,
  expires_at         DATETIME NOT NULL,
  used_at            DATETIME NULL,
  revoked_at         DATETIME NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_refresh_account (tb_user_account_id),
  KEY idx_refresh_family (family_id),
  CONSTRAINT fk_refresh_account FOREIGN KEY (tb_user_account_id)
    REFERENCES tb_user_account (id)
);
