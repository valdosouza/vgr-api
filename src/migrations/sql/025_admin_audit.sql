-- General administrative audit trail (decision 116 — phase S4, SEC-6).
-- Append-only: the code only ever INSERTs; no update, no delete, no soft-
-- delete column. Complements the specialized trails (tb_legal_gate_audit,
-- dual-control requests): before this, a wrongly granted privilege left
-- no record of WHO granted it.
CREATE TABLE IF NOT EXISTS tb_admin_audit (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id   INT NOT NULL,
  action     VARCHAR(20) NOT NULL,
  entity     VARCHAR(40) NOT NULL,
  entity_id  VARCHAR(40) NULL,
  -- Compact JSON of what changed (input as submitted, secrets stripped —
  -- decision 110: no password ever reaches a log, this table included).
  summary    TEXT NULL,
  ip         VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_audit (entity, entity_id, created_at),
  KEY idx_admin_audit_actor (actor_id, created_at)
);
