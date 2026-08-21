-- Reward domain — R0 (first slice), decisions 1/30/81-102/143-147.
-- Scope: MONETARY reward only (the guarantee mechanism). Non-monetary
-- reward (decision 1's broader "flexible, not necessarily financial") is
-- NOT modeled here — this table exists only once money is involved.
--
-- Decision 147: recipients are FIXED at reserve time, not discovered later
-- by mediation — tb_reward_recipient is written once, by reserveGuarantee,
-- and never grows afterward in this slice.

-- One reward per report (decision 1's success criterion 6: offer/update a
-- reward when registering a report — a single row is updated, not
-- versioned, in this slice). Born 'none'/'open' (decision 88's first
-- option) — reserving is a later, explicit action.
CREATE TABLE IF NOT EXISTS tb_reward_offer (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  tb_report_id             INT NOT NULL,
  amount_cents             INT NOT NULL,
  guarantee_mode           VARCHAR(10) NOT NULL DEFAULT 'none',
  status                   VARCHAR(10) NOT NULL DEFAULT 'open',
  -- Opaque PaymentRail id (decision 143) — never a Pix key, never an
  -- account number. NULL until reserved.
  rail_charge_id           VARCHAR(64) NULL,
  -- Decision 92: accepted at reserve time (release-after-condition has no
  -- return); empty until reserved — this table has no real copy to show
  -- yet (item 7 of rodada 3 is still open), the column just carries
  -- whatever version the caller supplies.
  no_return_notice_version VARCHAR(32) NOT NULL DEFAULT '',
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at              DATETIME NULL,
  deleted                  CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_reward_offer_report (tb_report_id),
  CONSTRAINT fk_reward_offer_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT chk_reward_guarantee_mode CHECK (guarantee_mode IN ('none', 'reserved')),
  CONSTRAINT chk_reward_offer_status CHECK (status IN ('open', 'reserved', 'released', 'refunded'))
);

-- Fixed at reserve() (decision 147) — never appended to after creation in
-- this slice. amount_cents across a reward's recipients must sum to the
-- offer's amount_cents (enforced in reward.service, not here).
CREATE TABLE IF NOT EXISTS tb_reward_recipient (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  tb_reward_offer_id INT NOT NULL,
  tb_help_offer_id   INT NOT NULL,
  amount_cents       INT NOT NULL,
  status             VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reward_recipient (tb_reward_offer_id, tb_help_offer_id),
  CONSTRAINT fk_reward_recipient_offer FOREIGN KEY (tb_reward_offer_id) REFERENCES tb_reward_offer (id),
  CONSTRAINT fk_reward_recipient_help_offer FOREIGN KEY (tb_help_offer_id) REFERENCES tb_help_offer (id),
  CONSTRAINT chk_reward_recipient_status CHECK (status IN ('pending', 'paid'))
);

-- Onboarding placeholder: maps an identified helper (decision 60 — identity
-- exists, just never exposed to the reporter) to the rail's opaque
-- recipient id (decision 143). NO endpoint produces this row yet in this
-- slice — reserveGuarantee throws a typed, catchable error when a targeted
-- helper has none. Building the actual onboarding flow (KYC data collection
-- for the PSP subconta) is deferred, not silently assumed.
CREATE TABLE IF NOT EXISTS tb_reward_recipient_profile (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  tb_user_account_id  INT NOT NULL,
  rail_recipient_id   VARCHAR(64) NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted             CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_reward_recipient_profile_account (tb_user_account_id),
  CONSTRAINT fk_reward_recipient_profile_account FOREIGN KEY (tb_user_account_id)
    REFERENCES tb_user_account (id)
);

-- Mediation privilege (decisions 98/147): judging fulfillment and
-- instructing capture/cancel. Panel resource, kind 'R' (pattern of
-- decisions 45/93/141), not on the menu tree.
INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Reward Mediation', 'reward_mediation', 'Operations', 'R', 5);

INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'reward_mediation' AND p.description IN ('VIEW', 'UPDATE');

-- Bootstrap: de-facto admins get it too (same pattern as 020/021/022/029/032).
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface s ON s.id = up.tb_interface_id AND s.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'reward_mediation'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';
