-- Mandatory panel 2FA (decision 114 — phase S5). totp_secret stores an
-- ENVELOPE payload (decisions 44/111), never the raw base32: a leaked
-- database must not hand out the second factor together with the hashes.
ALTER TABLE tb_user
  ADD COLUMN totp_secret  TEXT NULL,
  ADD COLUMN totp_enabled CHAR(1) NOT NULL DEFAULT 'N';

-- Recovery codes: 10 per enrollment, single-use, bcrypt-hashed (same
-- treatment as passwords — decision 110: no secret in clear text, ever).
CREATE TABLE IF NOT EXISTS tb_user_recovery_code (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  tb_user_id INT NOT NULL,
  code_hash  VARCHAR(60) NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recovery_user (tb_user_id),
  CONSTRAINT fk_recovery_user FOREIGN KEY (tb_user_id) REFERENCES tb_user (id)
);
