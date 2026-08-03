-- Decision 93: kind 'R' activated — permissionable resources that never go
-- to the menu. First real 'R': user_privileges, splitting *editing user
-- data* (interface `users`) from *granting access* (this resource).

INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('User Privileges', 'user_privileges', 'Administration', 'R', 1);

-- Grant/revoke is an UPDATE on the target's access; VIEW gates seeing the
-- matrix. INSERT/DELETE make no sense for this resource.
INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'user_privileges'
  AND p.description IN ('VIEW', 'UPDATE');

-- Bootstrap: whoever can UPDATE the Users screen today keeps their granting
-- power — they receive the new resource in full (no behavior change on
-- upgrade; separation starts on the next explicit revoke).
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT up.tb_user_id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user_has_privilege up
JOIN tb_interface u ON u.id = up.tb_interface_id AND u.i18n_key = 'users'
JOIN tb_privilege pu ON pu.id = up.tb_privilege_id AND pu.description = 'UPDATE'
JOIN tb_interface r ON r.i18n_key = 'user_privileges'
JOIN tb_interface_has_privilege ihp ON ihp.tb_interface_id = r.id
WHERE up.active = 'S' AND up.deleted = 'N';
