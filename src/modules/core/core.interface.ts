/** Menu tree returned by GET /api/core/menus (decision 71) — already
 *  filtered by the requesting user's VIEW grants; the app renders it as-is
 *  (mirrors setes-app's MenuModule/MenuInterface entities). */
export interface MenuInterface {
  id: number
  description: string
  i18nKey: string
  /** Privileges the user holds on this screen — feeds the app's can(). */
  privileges: string[]
}

export interface MenuModule {
  /** null for pseudo-modules derived from group_default (screens not
   *  linked to any Admin-managed module). */
  id: number | null
  description: string
  i18nKey: string | null
  imageIcon: string | null
  interfaces: MenuInterface[]
}

/** GET /api/core/me — the session user's own profile. */
export interface MeRow {
  id: number
  name: string
  email: string
  locale: string | null
}
