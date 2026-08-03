-- Permission model (decisions 68-75 in VGR-plano.md).
-- Single-schema by design: one installation per country, no multi-tenancy
-- (decision 68), no per-interface licensing (decision 69), no super user
-- (decision 70). Access = user x interface x privilege, mirroring the
-- setes-api design minus the institution layer (decision 71).

-- tb_admin_account evolves into tb_user, preserving existing accounts
-- (decision 74). AdminAccount (decision 67) becomes the team user governed
-- by privileges.
RENAME TABLE tb_admin_account TO tb_user;

ALTER TABLE tb_user
  ADD COLUMN name           VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN active         CHAR(1) NOT NULL DEFAULT 'S',
  ADD COLUMN locale         VARCHAR(10) NULL,
  ADD COLUMN last_login_at  DATETIME NULL,
  ADD COLUMN activation_key VARCHAR(12) NULL,
  ADD COLUMN updated_at     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  ADD COLUMN deleted        CHAR(1) NOT NULL DEFAULT 'N';

-- Privilege catalog. Description is the stable English identifier the code
-- references by NAME (never by magic id — decision-rounds note); the app
-- translates it via menu.privileges.<description>.
CREATE TABLE IF NOT EXISTS tb_privilege (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  description VARCHAR(60) NOT NULL UNIQUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted     CHAR(1) NOT NULL DEFAULT 'N'
);

-- Interface = one operable screen of the admin app (1 interface = 1
-- flutter_modular module on the client). kind: 'T' screen goes to menu /
-- 'R' resource-tab, reserved for future use (round-1 pending assumption:
-- MVP uses only 'T').
CREATE TABLE IF NOT EXISTS tb_interface (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  description   VARCHAR(120) NOT NULL,
  i18n_key      VARCHAR(60) NOT NULL UNIQUE,
  group_default VARCHAR(60) NOT NULL DEFAULT 'General',
  kind          CHAR(1) NOT NULL DEFAULT 'T',
  position      INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted       CHAR(1) NOT NULL DEFAULT 'N'
);

-- Which privileges exist for each screen (catalog, not concession).
CREATE TABLE IF NOT EXISTS tb_interface_has_privilege (
  tb_interface_id INT NOT NULL,
  tb_privilege_id INT NOT NULL,
  active          CHAR(1) NOT NULL DEFAULT 'S',
  deleted         CHAR(1) NOT NULL DEFAULT 'N',
  PRIMARY KEY (tb_interface_id, tb_privilege_id),
  CONSTRAINT fk_ihp_interface FOREIGN KEY (tb_interface_id) REFERENCES tb_interface (id),
  CONSTRAINT fk_ihp_privilege FOREIGN KEY (tb_privilege_id) REFERENCES tb_privilege (id)
);

-- Menu module = grouping of interfaces, managed by the Admin at runtime
-- (CRUD is new in VGR — setes never implemented it; decision 71).
CREATE TABLE IF NOT EXISTS tb_module (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  description VARCHAR(120) NOT NULL,
  i18n_key    VARCHAR(60) NULL,
  image_icon  VARCHAR(60) NULL,
  position    INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted     CHAR(1) NOT NULL DEFAULT 'N'
);

CREATE TABLE IF NOT EXISTS tb_module_has_interface (
  tb_module_id    INT NOT NULL,
  tb_interface_id INT NOT NULL,
  position        INT NOT NULL DEFAULT 0,
  active          CHAR(1) NOT NULL DEFAULT 'S',
  deleted         CHAR(1) NOT NULL DEFAULT 'N',
  PRIMARY KEY (tb_module_id, tb_interface_id),
  CONSTRAINT fk_mhi_module    FOREIGN KEY (tb_module_id)    REFERENCES tb_module (id),
  CONSTRAINT fk_mhi_interface FOREIGN KEY (tb_interface_id) REFERENCES tb_interface (id)
);

-- The effective concession: what each team user can do on each screen.
-- Enforced by the API on every endpoint (decision 72), not only by the menu.
CREATE TABLE IF NOT EXISTS tb_user_has_privilege (
  tb_user_id      INT NOT NULL,
  tb_interface_id INT NOT NULL,
  tb_privilege_id INT NOT NULL,
  active          CHAR(1) NOT NULL DEFAULT 'S',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted         CHAR(1) NOT NULL DEFAULT 'N',
  PRIMARY KEY (tb_user_id, tb_interface_id, tb_privilege_id),
  CONSTRAINT fk_uhp_user      FOREIGN KEY (tb_user_id)      REFERENCES tb_user (id),
  CONSTRAINT fk_uhp_interface FOREIGN KEY (tb_interface_id) REFERENCES tb_interface (id),
  CONSTRAINT fk_uhp_privilege FOREIGN KEY (tb_privilege_id) REFERENCES tb_privilege (id)
);

-- Seed: privilege catalog. VIEW is the privilege that puts a screen on the
-- user's menu. PRINT is cataloged but unused in the MVP.
INSERT INTO tb_privilege (id, description) VALUES
  (1, 'VIEW'),
  (2, 'INSERT'),
  (3, 'UPDATE'),
  (4, 'DELETE'),
  (5, 'PRINT');

-- Seed: the 5 existing admin screens (decision 56) + the 4 access-control
-- screens born in this phase (decision 71). i18n_key doubles as the stable
-- key requirePrivilege() uses on the API side.
INSERT INTO tb_interface (id, description, i18n_key, group_default, kind, position) VALUES
  (1, 'Risk Tier Configuration',  'risk_config',         'Operations',     'T', 1),
  (2, 'Category Forms',           'category_forms',      'Operations',     'T', 2),
  (3, 'Panic Responders',         'panic_responders',    'Operations',     'T', 3),
  (4, 'Dual Control Access',      'dual_control_access', 'Operations',     'T', 4),
  (5, 'Monetization Config',      'monetization_config', 'Operations',     'T', 5),
  (6, 'Users',                    'users',               'Administration', 'T', 1),
  (7, 'System Modules',           'system_modules',      'Administration', 'T', 2),
  (8, 'Interfaces',               'interfaces',          'Administration', 'T', 3),
  (9, 'Privileges',               'privileges',          'Administration', 'T', 4);

-- Seed: every screen exposes the 4 basic action privileges (PRINT stays out
-- of the per-screen catalog until a screen actually prints).
INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE p.description IN ('VIEW', 'INSERT', 'UPDATE', 'DELETE');

-- Bootstrap (decision 70): every pre-existing admin account receives every
-- cataloged privilege, so nobody is locked out when the binary role check
-- gives way to per-privilege enforcement.
INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
SELECT u.id, ihp.tb_interface_id, ihp.tb_privilege_id
FROM tb_user u, tb_interface_has_privilege ihp
WHERE u.deleted = 'N';
