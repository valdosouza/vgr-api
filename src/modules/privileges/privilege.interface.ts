/** Privilege catalog row (tb_privilege, migration 019 — decision 71).
 *  `description` is the stable English identifier (VIEW/INSERT/...); the app
 *  translates it via menu.privileges.<description>. */
export interface PrivilegeRow {
  id: number
  description: string
}

export interface PrivilegeInput {
  description: string
}
