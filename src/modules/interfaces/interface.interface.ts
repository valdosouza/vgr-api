/** Screen catalog row (tb_interface, migration 019 — decision 71).
 *  `i18nKey` is the stable key shared by requirePrivilege() on the API and
 *  the route map on the app. kind: 'T' screen goes to menu / 'R' reserved
 *  (round-1 pending assumption: MVP only uses 'T'). */
export interface InterfaceRow {
  id: number
  description: string
  i18nKey: string
  groupDefault: string
  kind: 'T' | 'R'
  position: number
  /** Privileges cataloged for this screen (tb_interface_has_privilege). */
  privilegeIds: number[]
}

export interface InterfaceInput {
  description: string
  i18nKey: string
  groupDefault: string
  kind: 'T' | 'R'
  position: number
  privilegeIds: number[]
}
