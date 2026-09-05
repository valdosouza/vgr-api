-- DS1 of plano-direction-sightings.md (decisions 200-207, closing the
-- original 22/26/27/28): the DirectionSighting/DirectionEstimate
-- aggregates. A community member near an OPEN report whose category
-- involves a fleeing subject taps one of 8 compass directions; the API
-- reconciles every sighting for that report into a single weighted
-- estimate SYNCHRONOUSLY (22), in the same request.
--
-- tb_direction_sighting is the append-only log — one row per logged
-- sighting, never updated or deleted (a sighting is a one-way signal,
-- decision confirmed in plano-direction-sightings.md §6: "revogar/editar
-- um apontamento já registrado" is explicitly out of scope). `weight` is
-- the RESOLVED identified-vs-anonymous multiplier (27/205) AT THE TIME OF
-- LOGGING — stored, never recomputed historically if the env var changes
-- later (mirrors client_key's role elsewhere: it is captured once, not a
-- live join to config). `client_key` is ONLY a replay-safety idempotency
-- key (137/28 — sightings ride the same mandatory offline queue as
-- reports) — unlike tb_report/tb_panic_alert, it never doubles as a
-- bearer secret for a future action, because a sighting is never
-- resolved/edited later; there is nothing to prove ownership of after
-- the fact. `account_id` is NULL for an anonymous sighting — identity is
-- social/interface-level, never forensic (23).
--
-- tb_direction_estimate is the materialized aggregate — one row per
-- (report, direction), accumulating total_weight/sighting_count
-- INCREMENTALLY on every insert (ON DUPLICATE KEY UPDATE) so
-- reconciliation stays O(1) rather than replaying every past sighting on
-- every read, which is how the synchronous requirement (22) stays cheap
-- even as a popular report accumulates many sightings. `first_reported_at`
-- is stamped ONLY at the row's creation (never touched by the UPDATE
-- clause) — it is the deterministic tie-break key of the reconciliation
-- algorithm (decision 26: the direction with the highest accumulated
-- weight wins; a tie is broken by whichever direction was reported FIRST
-- for this report). The disclosure floor (202, env-configurable,
-- shared/config/env.ts directionSightingConfig) sums sighting_count
-- ACROSS EVERY direction row of a report, never just the winner's own
-- count — reading all of a report's (at most 8) rows is cheap enough to
-- do on every read path (report detail, feed) without a separate counter
-- table.
--
-- Eligibility by category is FIXED IN CODE (decision 201, mirroring
-- modules/help-matching/dynamic-radius.ts's STRATEGY_BY_CATEGORY
-- pattern — see modules/direction-sightings/direction-sighting-
-- eligibility.ts) — no admin table, so DS3 (panel) stays empty (207).
--
-- 'location.tracking' is ALREADY seeded in tb_legal_capability by
-- migration 022_legal_gate.sql (it sat in PENDING_WIRING since the
-- catalog's founding, citing "decisions 7, 22, 26" verbatim) — the exact
-- same finding PP1 made for 'panic.dispatch' in 046. This migration does
-- NOT re-insert it (a second INSERT would duplicate the key and fail the
-- catalog partition spec's seed-mirror assertion) — it only removes the
-- PENDING_WIRING entry in shared/legal/capabilities.ts, backed by
-- direction-sightings.service.ts now calling assertCapability.
--
-- Rollback (manual — the runner is forward-only): DROP TABLE
-- tb_direction_estimate, then DROP TABLE tb_direction_sighting. The
-- 'location.tracking' capability row predates this migration (022) and
-- is not this migration's to remove.

CREATE TABLE IF NOT EXISTS tb_direction_sighting (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tb_report_id  INT NOT NULL,
  direction     VARCHAR(2) NOT NULL,
  weight        DECIMAL(3,2) NOT NULL,
  account_id    INT NULL,
  client_key    CHAR(36) NOT NULL UNIQUE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_direction_sighting_report (tb_report_id),
  CONSTRAINT fk_direction_sighting_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT fk_direction_sighting_account FOREIGN KEY (account_id) REFERENCES tb_user_account (id),
  CONSTRAINT chk_direction_sighting_direction CHECK (direction IN ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')),
  CONSTRAINT chk_direction_sighting_weight CHECK (weight > 0)
);

CREATE TABLE IF NOT EXISTS tb_direction_estimate (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  tb_report_id       INT NOT NULL,
  direction          VARCHAR(2) NOT NULL,
  total_weight       DECIMAL(10,2) NOT NULL DEFAULT 0,
  sighting_count     INT NOT NULL DEFAULT 0,
  first_reported_at  DATETIME NOT NULL,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_direction_estimate (tb_report_id, direction),
  CONSTRAINT fk_direction_estimate_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT chk_direction_estimate_direction CHECK (direction IN ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'))
);
