/**
 * Privilege catalog constants — always referenced by NAME, never by magic id
 * (lesson from setes-app's `_visualizarId = 6`; decision 71). Must match the
 * `tb_privilege.description` seed in migration 019.
 */
export const Privileges = {
  /** Puts a screen on the user's menu and allows GET endpoints. */
  VIEW: 'VIEW',
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  PRINT: 'PRINT',
} as const

export type Privilege = (typeof Privileges)[keyof typeof Privileges]

/**
 * Interface keys (`tb_interface.i18n_key`) — the stable identifier shared by
 * the API guard (`requirePrivilege`), the menu tree and the app's route map.
 * Must match the `tb_interface` seed in migration 019.
 */
export const InterfaceKeys = {
  RISK_CONFIG: 'risk_config',
  CATEGORY_FORMS: 'category_forms',
  PANIC_RESPONDERS: 'panic_responders',
  DUAL_CONTROL_ACCESS: 'dual_control_access',
  MONETIZATION_CONFIG: 'monetization_config',
  USERS: 'users',
  SYSTEM_MODULES: 'system_modules',
  INTERFACES: 'interfaces',
  PRIVILEGES: 'privileges',
  /** kind 'R' resource (decision 93): granting access on the Users screen —
   *  separate from editing user data. */
  USER_PRIVILEGES: 'user_privileges',
  /** kind 'R' resource (decisions 45/93): the approver role of the
   *  dual-control gate — separate from operating the screen. */
  DUAL_CONTROL_APPROVAL: 'dual_control_approval',
  /** Legal Gate screens (decisions 106, 107 — migration 022). */
  LEGAL_JURISDICTIONS: 'legal_jurisdictions',
  LEGAL_CAPABILITIES: 'legal_capabilities',
  LEGAL_RULES: 'legal_rules',
  /** kind 'R' resources (decision 130 — migration 029): reviewing evidence
   *  derivatives vs seeing the reporter-reidentifying EXIF original. */
  MEDIA_EVIDENCE: 'media_evidence',
  MEDIA_ORIGINAL: 'media_original',
} as const

export type InterfaceKey = (typeof InterfaceKeys)[keyof typeof InterfaceKeys]
