-- B4 of plano-moderacao-painel.md (decisions 164/165): the panel can now
-- read AGGREGATED report statistics. One interface:
--
--   report_stats — kind 'T' screen in "Operations", VIEW only (165).
--                  Serves counters by period x category x subject x
--                  status x tier plus frozen/hidden/expired/purged and
--                  the moderation reasons, every cell under the k = 5
--                  floor (164). Aggregates are not evidence, so the read
--                  is NOT audited (unlike the case detail, 166), and no
--                  geo aggregation exists in this phase (164).
--
-- Position 7 follows the 'T' screens of Operations (risk_config 1 ...
-- reports 6, migration 038).

INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Report Statistics', 'report_stats', 'Operations', 'T', 7);

INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'report_stats' AND p.description = 'VIEW';

-- Bootstrap: the de-facto administrators (UPDATE on the Users screen —
-- same upgrade pattern as migrations 020/021/022/029/032/038) get the
-- statistics screen (165).
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface s ON s.id = up.tb_interface_id AND s.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'report_stats'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';
