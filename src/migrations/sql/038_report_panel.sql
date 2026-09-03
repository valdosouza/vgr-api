-- B1 of plano-moderacao-painel.md (decisions 159/165/166): the panel can
-- now SEARCH reports and open a case detail. Two interfaces:
--
--   reports                — kind 'T' screen in "Operations". VIEW = search
--                            + open the detail (each detail read audited,
--                            166); UPDATE = moderate / mark reviewed —
--                            reserved for B2/B3, declared now so grants can
--                            be prepared ahead of those phases (165).
--   report_exact_position  — kind 'R' resource (mechanism of decision 93).
--                            VIEW = reading the EXACT position of a case
--                            (159). Deliberately separate from `reports`:
--                            the detail serves the tier-DEGRADED grid
--                            (135); the exact point — in domestic violence
--                            the victim's home — only leaves through this
--                            grant, and every read is audited.

INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Reports', 'reports', 'Operations', 'T', 6),
  ('Report Exact Position', 'report_exact_position', 'Operations', 'R', 6);

INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'reports' AND p.description IN ('VIEW', 'UPDATE');

INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'report_exact_position' AND p.description = 'VIEW';

-- Bootstrap: the de-facto administrators (UPDATE on the Users screen —
-- same upgrade pattern as migrations 020/021/022/029/032) get the Reports
-- screen with both privileges.
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface s ON s.id = up.tb_interface_id AND s.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'reports'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';

-- report_exact_position gets NO bootstrap on purpose (decision 159 — same
-- as media_original in 029): nobody reads the exact position until a
-- human explicitly grants it (minimization, decision 110).
