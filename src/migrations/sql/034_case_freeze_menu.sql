-- P1 (decisions 141/142): the case-freeze screen now EXISTS in the panel,
-- so the interface leaves the screenless-resource kind ('R', chosen in 032
-- when only the API side existed) and joins the menu — GET /api/core/menus
-- serves kind 'T' only. Same row, same grants: nothing else changes.
UPDATE tb_interface SET kind = 'T' WHERE i18n_key = 'case_freeze';
