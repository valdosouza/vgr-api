-- Legal Gate (decisions 76-79, 103-109 in VGR-plano.md; plan in
-- AI/docs/plans/plano-legal-gate.md). Per-jurisdiction execution blocking:
-- capability x jurisdiction -> declared status, enforced by the API.
-- Fail-closed (decision 104): a capability with no active rule in a real
-- jurisdiction behaves as blocked; only SANDBOX inverts the default
-- (decision 79).

-- Jurisdictions. One installation serves one country (decisions 68, 105);
-- extra rows exist for SANDBOX and for rules authored ahead of expansion.
-- operational_state is the kill switch (decision 107): read with TTL zero,
-- 'suspended' shuts every gated capability at once.
CREATE TABLE IF NOT EXISTS tb_jurisdiction (
  code                 VARCHAR(10) NOT NULL PRIMARY KEY,
  name                 VARCHAR(80) NOT NULL,
  operational_state    VARCHAR(12) NOT NULL DEFAULT 'live',
  is_sandbox           CHAR(1) NOT NULL DEFAULT 'N',
  -- Reactivation needs a second person (decision 107: shut down with one,
  -- turn back on with two) — a pending 'live' waits here for confirmation.
  pending_state        VARCHAR(12) NULL,
  pending_by           INT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted              CHAR(1) NOT NULL DEFAULT 'N',
  CONSTRAINT chk_jurisdiction_state CHECK (operational_state IN ('live', 'restricted', 'suspended'))
);

-- Capability catalog — mirrors src/shared/legal/capabilities.ts (decision
-- 103; the TS catalog is the enforcement source of truth, this table backs
-- the admin UI and the rule FK). A spec test asserts both stay in sync.
CREATE TABLE IF NOT EXISTS tb_legal_capability (
  capability   VARCHAR(80) NOT NULL PRIMARY KEY,
  description  VARCHAR(200) NOT NULL,
  module       VARCHAR(60) NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted      CHAR(1) NOT NULL DEFAULT 'N'
);

-- Versioned rules — never UPDATE-in-place: a new version supersedes the
-- previous one, so "what was in force on day X?" always has an answer
-- (plan §6). Dual control lives in the row itself (decision 107): a rule
-- is born 'proposed' by one user and only enforced after a DIFFERENT user
-- approves it ('active').
CREATE TABLE IF NOT EXISTS tb_legal_rule (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  capability        VARCHAR(80) NOT NULL,
  jurisdiction_code VARCHAR(10) NOT NULL,
  version           INT NOT NULL,
  -- What the rule declares (decision 78): allowed | restricted | blocked.
  status            VARCHAR(12) NOT NULL,
  -- Typed motive, mandatory whenever not allowed (decision 78 / plan L4):
  -- no_control | legislation | self_preservation.
  reason            VARCHAR(20) NULL,
  legal_basis       TEXT NULL,
  -- none -> ai_assessed -> counsel_confirmed (decision 77). Counsel review
  -- upgrades this field on the same record — no code change.
  review_state      VARCHAR(20) NOT NULL DEFAULT 'none',
  -- proposed -> active | rejected; active -> superseded (decision 107).
  rule_state        VARCHAR(12) NOT NULL DEFAULT 'proposed',
  effective_from    DATETIME NULL,
  -- Every rule expires (decision 108) — default 180 days, set by the
  -- service at approval time. Expired = unreviewed = blocked (decision 104).
  expires_at        DATETIME NULL,
  proposed_by       INT NOT NULL,
  approved_by       INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at        DATETIME NULL,
  deleted           CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_rule_version (capability, jurisdiction_code, version),
  KEY idx_rule_lookup (capability, jurisdiction_code, rule_state),
  CONSTRAINT fk_rule_capability   FOREIGN KEY (capability) REFERENCES tb_legal_capability (capability),
  CONSTRAINT fk_rule_jurisdiction FOREIGN KEY (jurisdiction_code) REFERENCES tb_jurisdiction (code),
  CONSTRAINT fk_rule_proposer     FOREIGN KEY (proposed_by) REFERENCES tb_user (id),
  CONSTRAINT chk_rule_status  CHECK (status IN ('allowed', 'restricted', 'blocked')),
  CONSTRAINT chk_rule_state   CHECK (rule_state IN ('proposed', 'active', 'rejected', 'superseded')),
  CONSTRAINT chk_rule_review  CHECK (review_state IN ('none', 'ai_assessed', 'counsel_confirmed')),
  -- A block without a declared motive does not exist in the model (L4).
  CONSTRAINT chk_rule_reason  CHECK (status = 'allowed' OR reason IN ('no_control', 'legislation', 'self_preservation'))
);

-- Append-only decision log (plan L6: nothing is blocked silently). The code
-- only ever INSERTs here — no UPDATE, no DELETE, no soft-delete column.
CREATE TABLE IF NOT EXISTS tb_legal_gate_audit (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  capability        VARCHAR(80) NOT NULL,
  jurisdiction_code VARCHAR(10) NOT NULL,
  rule_id           INT NULL,
  rule_version      INT NULL,
  -- blocked | demo (sandbox allow) | degraded (served from stale cache,
  -- decision 109). Plain allows under an active rule are NOT audited —
  -- volume would drown the log and the rule row already proves the basis
  -- (amendment note in docs/feature/legal-gate.md).
  outcome           VARCHAR(12) NOT NULL,
  reason            VARCHAR(20) NULL,
  user_ref          VARCHAR(40) NULL,
  ip                VARCHAR(45) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_lookup (capability, jurisdiction_code, created_at)
);

-- Seed: jurisdictions. SANDBOX inverts the fail-closed default (decision
-- 79) and is where demos run; BR is this installation's real jurisdiction
-- (decision 24 default set), born 'live' but with every capability
-- unreviewed — i.e. blocked until someone declares otherwise.
INSERT INTO tb_jurisdiction (code, name, operational_state, is_sandbox) VALUES
  ('SANDBOX', 'Sandbox / Demonstration', 'live', 'S'),
  ('BR',      'Brazil',                  'live', 'N');

-- Seed: capability catalog (plan §5; kept in sync with capabilities.ts).
INSERT INTO tb_legal_capability (capability, description, module) VALUES
  ('report.anonymous',                'Anonymous reporting with hidden forensic accountability log (decisions 23, 32)', 'report'),
  ('reward.offer',                    'Publishing a reward promise — Codigo Civil arts. 854-860 (decisions 1, 30)',     'reward'),
  ('reward.monetary',                 'Monetary reward via the payment rail (decisions 82, 97) — requires reward.mediation', 'reward'),
  ('reward.mediation',                'Deciding condition fulfillment and instructing release/refund of held funds (decision 98)', 'reward'),
  ('reward.intermediation.delegated', 'Payment intermediation by a licensed third-party PSP (decisions 81, 91, 100)',   'reward'),
  ('reward.intermediation.own',       'VGR as payment intermediary — blocked until central-bank authorization (decisions 81, 99)', 'reward'),
  ('minor.data_retention',            'Retention of missing-child report data (decision 25 — LGPD art. 14)',            'identity'),
  ('identity.disclosure',             'Helper identity disclosure flows (decisions 6, 34, 40)',                          'identity'),
  ('location.tracking',               'Location trails and direction sightings (decisions 7, 22, 26)',                   'report'),
  ('data.cross_border',               'Cross-border transfer of personal data (decision 105 isolation)',                 'core'),
  ('panic.dispatch',                  'Panic-button dispatch to registered responders (decisions 51-52, 62-63)',         'panic');

-- Seed: admin screens for the legal-policy module (decision 106 — L1 ships
-- administrable). Screen keys double as requirePrivilege() interface keys.
INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Legal Jurisdictions', 'legal_jurisdictions', 'Legal', 'T', 1),
  ('Legal Capabilities',  'legal_capabilities',  'Legal', 'T', 2),
  ('Legal Rules',         'legal_rules',         'Legal', 'T', 3);

-- Jurisdictions: VIEW + UPDATE (kill switch / reactivation — decision 107).
-- Capabilities: VIEW only (catalog is seeded by migration, not edited).
-- Rules: VIEW + INSERT (propose) + UPDATE (approve/reject decision flows).
INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id FROM tb_interface i, tb_privilege p
WHERE (i.i18n_key = 'legal_jurisdictions' AND p.description IN ('VIEW', 'UPDATE'))
   OR (i.i18n_key = 'legal_capabilities'  AND p.description = 'VIEW')
   OR (i.i18n_key = 'legal_rules'         AND p.description IN ('VIEW', 'INSERT', 'UPDATE'));

-- Bootstrap: whoever holds UPDATE on the Users screen (the de-facto
-- administrators, decision 70) receives the new legal screens in full —
-- same upgrade pattern as migrations 020/021.
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT DISTINCT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface u  ON u.id = up.tb_interface_id AND u.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r  ON r.i18n_key IN ('legal_jurisdictions', 'legal_capabilities', 'legal_rules')
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';
