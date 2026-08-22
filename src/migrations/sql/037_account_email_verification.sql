-- Email verification for app accounts (decision 151 — reuses the panel's
-- mailer, but with its OWN 6-digit code / TTL / attempt counter, mirroring
-- tb_user's activation_key + recovery_attempt_count (decision 113) rather
-- than sharing that row with the panel plane (decision 119).

ALTER TABLE tb_user_account
  ADD COLUMN email_verification_code CHAR(6) NULL,
  ADD COLUMN email_verification_sent_at DATETIME NULL,
  ADD COLUMN email_verification_attempts INT NOT NULL DEFAULT 0;
