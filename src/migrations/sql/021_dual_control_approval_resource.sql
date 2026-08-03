-- Second kind-'R' resource (mechanism of decision 93, applied to decision
-- 45): approving a dual-control access request becomes its own grantable
-- role, separate from operating the screen. Requesters (INSERT on the
-- screen) and approvers (UPDATE on this resource) can now be different
-- people — strengthening the 2-distinct-approver gate.

INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Dual Control Approval', 'dual_control_approval', 'Operations', 'R', 1);

-- Only UPDATE: approving is the single act this resource governs (no
-- separate VIEW — seeing requests belongs to the screen's VIEW).
INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'dual_control_approval'
  AND p.description = 'UPDATE';

-- Bootstrap: whoever can UPDATE the screen today keeps approving — no
-- behavior change on upgrade; separation starts on the next explicit revoke.
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface s ON s.id = up.tb_interface_id AND s.i18n_key = 'dual_control_access'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'dual_control_approval'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';
