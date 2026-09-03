-- B5 of plano-moderacao-painel.md (decisions 116/158/165/166): the panel
-- can now READ the administrative trail. One interface:
--
--   admin_audit — kind 'T' screen in "Administration", VIEW only (165).
--                 Lists / opens tb_admin_audit rows. The table stays
--                 append-only (116): this phase adds READ and nothing
--                 else — no update, no delete, ever. Reading the trail is
--                 NOT audited (166 — auditing the audit would be
--                 recursive and would drown the trail).
--
-- Position 5 follows the 'T' screens of Administration (users 1,
-- system_modules 2, interfaces 3, privileges 4 — migration 019).

INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Admin Audit', 'admin_audit', 'Administration', 'T', 5);

INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'admin_audit' AND p.description = 'VIEW';

-- Bootstrap: the de-facto administrators (UPDATE on the Users screen —
-- same upgrade pattern as migrations 020/021/022/029/032/038/040) get
-- the trail screen (165).
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface s ON s.id = up.tb_interface_id AND s.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'admin_audit'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';

-- Indexes for the screen's list and its filters: 025 already keys
-- (entity, entity_id, created_at) and (actor_id, created_at); the
-- unfiltered newest-first list and the action filter get their own.
ALTER TABLE tb_admin_audit
  ADD KEY idx_admin_audit_created (created_at),
  ADD KEY idx_admin_audit_action (action, created_at);
