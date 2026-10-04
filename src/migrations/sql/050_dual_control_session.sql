-- Round 18 (decisions 223-229, AI/docs/plans/plano-dual-control.md):
-- the dual-control gate of decision 45 becomes real.
--
-- Until now the "approver" was whatever the request BODY said (a free
-- text id, from the days the panel had no session), so ONE admin holding
-- both grants could post two approvals with two typed ids and reach the
-- 2-distinct-approver threshold alone. From here on:
--
--   223  requester and approver come from the SESSION (tb_user ids);
--   224  the request IS the first authorization and ONE approval by a
--        DIFFERENT user grants (the house pattern of 107 and 141d) —
--        guaranteed here by a CHECK, not only by the service;
--   225  every existing request is VOIDED and kept as history; the typed
--        approvers survive only as `legacy_approver_ids`.
--
-- Nothing consumed 'granted' before this migration (there is no reveal
-- route — decision 228 keeps it for its own round), so voiding takes no
-- access away from anyone.

ALTER TABLE tb_dual_control_access_request
  CHANGE COLUMN approver_ids legacy_approver_ids JSON NULL,
  ADD COLUMN requested_by INT NULL AFTER legal_basis,
  ADD COLUMN approved_by  INT NULL AFTER requested_by,
  ADD COLUMN approved_at  DATETIME NULL AFTER approved_by,
  MODIFY COLUMN status ENUM('pending', 'granted', 'void') NOT NULL DEFAULT 'pending';

-- 225: the typed approvals prove nothing — none of them may count.
UPDATE tb_dual_control_access_request SET status = 'void';

ALTER TABLE tb_dual_control_access_request
  ADD CONSTRAINT fk_dual_control_requested_by FOREIGN KEY (requested_by) REFERENCES tb_user (id),
  ADD CONSTRAINT fk_dual_control_approved_by  FOREIGN KEY (approved_by)  REFERENCES tb_user (id),
  -- A live request always knows who opened it (223).
  ADD CONSTRAINT chk_dual_control_requester CHECK (status = 'void' OR requested_by IS NOT NULL),
  -- Granted = approved by someone OTHER than the requester (224): even a
  -- bug in the service cannot store a one-person grant.
  ADD CONSTRAINT chk_dual_control_two_people CHECK (
    status <> 'granted' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> requested_by)
  ),
  ADD KEY idx_dual_control_created (created_at);
