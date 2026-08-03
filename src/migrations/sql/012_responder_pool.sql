CREATE TABLE IF NOT EXISTS tb_responder_pool_membership (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  status          ENUM('pending', 'approved', 'denied') NOT NULL DEFAULT 'pending',
  -- Free text pending decision 52's resolution — no eligibility criteria
  -- are decided yet (amendment: added alongside admin task 05, which
  -- surfaces this as a free-text field on ResponderApprovalEntity).
  criteria_notes  VARCHAR(500) NULL,
  requested_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at     DATETIME NULL,
  resolved_by     INT NULL
);
