-- Mediation discipline (decision 98, closed by decisions 148/149/150):
-- published criteria versions, dual-controlled resolution, contest window
-- before execution, and an append-only mediation log (pattern of
-- decision 76 — no UPDATE/DELETE path exists in code for the log).

-- Decision 150: publishing criteria creates an IMMUTABLE version —
-- correcting means publishing a new one, so there is no updated_at and no
-- soft delete on purpose. The active version is the latest published.
CREATE TABLE IF NOT EXISTS tb_mediation_criteria (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  version      VARCHAR(32) NOT NULL,
  body         TEXT NOT NULL,
  published_by INT NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mediation_criteria_version (version),
  CONSTRAINT fk_mediation_criteria_user FOREIGN KEY (published_by) REFERENCES tb_user (id)
);

-- Decision 150: the version active at reserve time is stamped on the
-- offer — publishing later versions never changes an already-reserved
-- case's rules. Empty until reserved.
ALTER TABLE tb_reward_offer
  ADD COLUMN criteria_version VARCHAR(32) NOT NULL DEFAULT '';

-- Decision 148: propose (mediator A) -> approve (mediator B, distinct) ->
-- decision 149: contest window -> execute (rail capture/cancel). At most
-- one live (proposed/approved) resolution per offer, enforced in service.
CREATE TABLE IF NOT EXISTS tb_reward_resolution (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  tb_reward_offer_id INT NOT NULL,
  outcome            VARCHAR(15) NOT NULL,
  reason             TEXT NOT NULL,
  criteria_version   VARCHAR(32) NOT NULL,
  proposed_by        INT NOT NULL,
  proposed_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by        INT NULL,
  approved_at        DATETIME NULL,
  window_ends_at     DATETIME NULL,
  executed_at        DATETIME NULL,
  status             VARCHAR(12) NOT NULL DEFAULT 'proposed',
  KEY idx_reward_resolution_offer (tb_reward_offer_id),
  CONSTRAINT fk_reward_resolution_offer FOREIGN KEY (tb_reward_offer_id) REFERENCES tb_reward_offer (id),
  CONSTRAINT fk_reward_resolution_proposer FOREIGN KEY (proposed_by) REFERENCES tb_user (id),
  CONSTRAINT chk_reward_resolution_outcome CHECK (outcome IN ('fulfilled', 'not_fulfilled')),
  CONSTRAINT chk_reward_resolution_status CHECK (status IN ('proposed', 'approved', 'executed', 'cancelled'))
);

-- Decision 149: a party (payer or fixed recipient's helper) contests while
-- the money is still retained; an open contest blocks execution until a
-- mediator closes it with a note or the resolution is cancelled.
CREATE TABLE IF NOT EXISTS tb_reward_contest (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  tb_reward_resolution_id INT NOT NULL,
  tb_user_account_id      INT NOT NULL,
  body                    TEXT NOT NULL,
  status                  VARCHAR(8) NOT NULL DEFAULT 'open',
  closed_by               INT NULL,
  closed_note             TEXT NULL,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at               DATETIME NULL,
  KEY idx_reward_contest_resolution (tb_reward_resolution_id),
  CONSTRAINT fk_reward_contest_resolution FOREIGN KEY (tb_reward_resolution_id) REFERENCES tb_reward_resolution (id),
  CONSTRAINT fk_reward_contest_account FOREIGN KEY (tb_user_account_id) REFERENCES tb_user_account (id),
  CONSTRAINT chk_reward_contest_status CHECK (status IN ('open', 'closed'))
);

-- Append-only mediation trail (decisions 98/76): every step of the
-- discipline lands here. Code never updates or deletes rows.
CREATE TABLE IF NOT EXISTS tb_reward_mediation_log (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  tb_reward_offer_id INT NOT NULL,
  event_type         VARCHAR(20) NOT NULL,
  actor_ref          VARCHAR(32) NOT NULL,
  details            TEXT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reward_mediation_log_offer (tb_reward_offer_id),
  CONSTRAINT fk_reward_mediation_log_offer FOREIGN KEY (tb_reward_offer_id) REFERENCES tb_reward_offer (id)
);
