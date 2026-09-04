-- PP1 of plano-panico.md (decisions 51, 190-199): the PanicAlert
-- aggregate. A SINGLE SHOT (191) — one position captured at trigger
-- time, no live/streaming session, no position updates after that.
--
-- Ownership mirrors tb_report (030_reports.sql): client_key is the
-- app-generated idempotency key (pattern of 137) AND the anonymous
-- triggerer's bearer secret (134) in one — presenting it on resolve
-- proves ownership exactly like a report's client_key does. A cold,
-- anonymous witness can trigger exactly like an anonymous reporter can
-- file a report (32/35, decision 65's "no configuration required at the
-- click"); account_id is set when the caller is identified, NULL
-- otherwise — identity is social/interface-level, never forensic (23).
--
-- Position: lat/lng hold the EXACT trigger position; it NEVER leaves the
-- API (135's posture applied here) — a responder is served only the
-- rounded distance to their OWN position (195), never raw coordinates.
--
-- tb_panic_alert_recipient snapshots the responder pool AT TRIGGER TIME
-- (event PanicAlertTriggered {alertId, triggeredBy, recipients[],
-- position} of the tactical spec, 003-api-tactical-design.md): a
-- responder who joins the pool AFTER an alert fired never sees it
-- retroactively — GET /app-panic/alerts is a lookup against this table,
-- never a live membership query. No FK to
-- tb_responder_pool_membership on purpose: a membership can later be
-- revoked without invalidating the historical fact that this responder
-- WAS a recipient at trigger time. An EMPTY snapshot is expected and
-- valid — the alert is created regardless (65: never refuse for a
-- momentarily empty pool).
--
-- 'panic.dispatch' is already seeded in tb_legal_capability by migration
-- 022 (022_legal_gate.sql) — it was declared PENDING_WIRING since the
-- catalog's founding and this delivery only WIRES it
-- (panic-alert.service.ts triggerAlert, asserted before the insert) and
-- removes it from src/shared/legal/capabilities.ts's PENDING_WIRING set;
-- no new seed row here (a second INSERT would duplicate the key and fail
-- the catalog partition spec's seed-mirror assertion).
--
-- Rollback (manual — the runner is forward-only): DROP TABLE
-- tb_panic_alert_recipient, then DROP TABLE tb_panic_alert. The
-- 'panic.dispatch' capability row predates this migration (022) and is
-- not this migration's to remove.

CREATE TABLE IF NOT EXISTS tb_panic_alert (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  client_key  CHAR(36) NOT NULL UNIQUE,
  account_id  INT NULL,
  lat         DECIMAL(9,6) NOT NULL,
  lng         DECIMAL(9,6) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  KEY idx_panic_alert_account (account_id),
  CONSTRAINT fk_panic_alert_account FOREIGN KEY (account_id)
    REFERENCES tb_user_account (id),
  CONSTRAINT chk_panic_alert_status CHECK (status IN ('active', 'resolved'))
);

CREATE TABLE IF NOT EXISTS tb_panic_alert_recipient (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  tb_panic_alert_id     INT NOT NULL,
  responder_account_id  INT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_panic_alert_recipient (tb_panic_alert_id, responder_account_id),
  KEY idx_panic_alert_recipient_responder (responder_account_id, tb_panic_alert_id),
  CONSTRAINT fk_panic_alert_recipient_alert FOREIGN KEY (tb_panic_alert_id)
    REFERENCES tb_panic_alert (id),
  CONSTRAINT fk_panic_alert_recipient_responder FOREIGN KEY (responder_account_id)
    REFERENCES tb_user_account (id)
);
