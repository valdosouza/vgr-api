-- R4 of plano-denuncia.md: media attached to reports (M2, decisions
-- 128/129/134/136/138, amendment E4).

-- The attachment REFERENCES tb_media (amendment E4: never a report column
-- on tb_media — media stays report-agnostic; the link is the report's).
-- The UNIQUE key makes an offline-queue attach replay idempotent: the
-- second insert collides and the service answers the same 200.
CREATE TABLE IF NOT EXISTS tb_report_media (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  tb_report_id INT NOT NULL,
  tb_media_id  INT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted      CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_report_media (tb_report_id, tb_media_id),
  KEY idx_report_media_media (tb_media_id),
  CONSTRAINT fk_report_media_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT fk_report_media_media FOREIGN KEY (tb_media_id) REFERENCES tb_media (id)
);

-- M2 activates the pending -> available lifecycle that migration 028
-- declared: 'available' now MEANS attached (the attach consumes 'pending',
-- decision 134). M1 inserted uploads as 'available' because no attach
-- existed — at this migration's moment nothing was ever attached, so every
-- living 'available' row is an unattached upload: flip them back to
-- 'pending'. From here on they either get attached or expire as orphans
-- (48h, decision 136).
UPDATE tb_media SET status = 'pending' WHERE status = 'available';

-- Legal capability of decision 138: attaching media to a report carries
-- jurisdiction-dependent legal risk. Wired in this same delivery
-- (reports.service attach), so it never sits in PENDING_WIRING.
INSERT INTO tb_legal_capability (capability, description, module) VALUES
  ('report.media', 'Attaching image evidence to a report (decisions 129, 134, 138)', 'report');
