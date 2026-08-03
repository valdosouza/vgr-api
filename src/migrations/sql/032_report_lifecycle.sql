-- R3 of plano-denuncia.md: help offers, freeze/unfreeze, purge support.

-- Help offers (spec tasks 06/07, decisions 10/20/34/35). helper_account_id
-- NULL = anonymous helper (35) — informed they cannot claim a reward (34).
-- The UNIQUE key blocks a second identified offer per report; NULLs stay
-- free so anonymous offers are not artificially limited.
CREATE TABLE IF NOT EXISTS tb_help_offer (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  tb_report_id      INT NOT NULL,
  helper_account_id INT NULL,
  anonymous         CHAR(1) NOT NULL DEFAULT 'N',
  help_type         VARCHAR(30) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted           CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_offer_helper (tb_report_id, helper_account_id),
  KEY idx_offer_report (tb_report_id),
  CONSTRAINT fk_offer_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT fk_offer_helper FOREIGN KEY (helper_account_id) REFERENCES tb_user_account (id),
  -- Fixed list of decision 10 — the app offers these choices.
  CONSTRAINT chk_offer_type CHECK (help_type IN
    ('physical_presence', 'relay_information', 'remote_support', 'share', 'financial_contribution'))
);

-- Freeze bookkeeping (decision 141): reason is MANDATORY (e.g. case/writ
-- number) and lives here; the who/when/from-where lives in tb_admin_audit.
-- Deliberately NO timeline event: the timeline is participant-visible and
-- a freeze would tip off a reporter under investigation.
ALTER TABLE tb_report
  ADD COLUMN frozen_reason VARCHAR(120) NULL,
  ADD COLUMN frozen_at DATETIME NULL,
  ADD COLUMN purged CHAR(1) NOT NULL DEFAULT 'N';

-- Purge (decisions 25/131) nulls the sensitive payload while keeping the
-- statistical skeleton (category/subject/status/dates) — position must be
-- nullable for that.
ALTER TABLE tb_report
  MODIFY COLUMN lat DECIMAL(9,6) NULL,
  MODIFY COLUMN lng DECIMAL(9,6) NULL;

-- Unfreeze is the dangerous act (it re-arms destruction): dual-control —
-- one admin requests, a DIFFERENT admin approves (decision 141d, pattern
-- of decisions 45/107).
CREATE TABLE IF NOT EXISTS tb_report_unfreeze (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  tb_report_id INT NOT NULL,
  reason       VARCHAR(120) NOT NULL,
  requested_by INT NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by  INT NULL,
  approved_at  DATETIME NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending',
  KEY idx_unfreeze_report (tb_report_id, status),
  CONSTRAINT fk_unfreeze_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT chk_unfreeze_status CHECK (status IN ('pending', 'approved'))
);

-- Panel resource for the whole flow (decisions 141/142) — the ONE panel
-- screen this front adds. VIEW = look a case up; UPDATE = freeze/request/
-- approve (the request-vs-approve separation is enforced in the service:
-- distinct users, decision 141d).
INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Case Freeze', 'case_freeze', 'Operations', 'R', 4);

INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'case_freeze' AND p.description IN ('VIEW', 'UPDATE');

-- Bootstrap: de-facto admins (same pattern as 020/021/022/029). Approving
-- an unfreeze still needs a SECOND holder — with a single admin, unfreeze
-- stays impossible until another grant exists, which is the dual-control
-- philosophy working as intended (45/107).
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface s ON s.id = up.tb_interface_id AND s.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'case_freeze'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';
