-- Panel access to evidence media (M3 of plano-imagens.md, decision 130).
-- Two kind-'R' resources (mechanism of decision 93) instead of one:
--
--   media_evidence  — seeing the SERVED derivatives (normalized/thumb/blur)
--                     of any media, e.g. while reviewing a report.
--   media_original  — seeing the EXIF ORIGINAL a reporter chose to keep
--                     (decision 130). Deliberately separate: the original
--                     carries where/when/what-device — exactly the
--                     reporter-reidentifying data that is asset #1 of the
--                     security plan. Being able to review evidence must not
--                     silently include it.
--
-- Every panel read of either is audited (decision 116, action 'read').

INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Media Evidence', 'media_evidence', 'Operations', 'R', 2),
  ('Media Original', 'media_original', 'Operations', 'R', 3);

-- VIEW is the single act each resource governs.
INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key IN ('media_evidence', 'media_original')
  AND p.description = 'VIEW';

-- Bootstrap: the de-facto administrators (UPDATE on the Users screen —
-- same upgrade pattern as migrations 020/021/022) can review evidence.
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface s ON s.id = up.tb_interface_id AND s.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'media_evidence'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';

-- media_original gets NO bootstrap on purpose: nobody sees reporter-
-- reidentifying data until a human explicitly grants it (minimization,
-- decision 110 — the safe default is the empty grant).
