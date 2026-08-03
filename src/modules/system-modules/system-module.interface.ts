/** Menu module row (tb_module, migration 019 — decision 71). Groups screens
 *  on the admin menu; managed by the Admin at runtime. This CRUD is new in
 *  VGR — setes-api reads tb_module but never implemented its endpoint. */
export interface SystemModuleRow {
  id: number
  description: string
  i18nKey: string | null
  imageIcon: string | null
  position: number
  /** Screens inside the module, in menu order (tb_module_has_interface). */
  interfaceIds: number[]
}

export interface SystemModuleInput {
  description: string
  i18nKey: string | null
  imageIcon: string | null
  position: number
  interfaceIds: number[]
}
