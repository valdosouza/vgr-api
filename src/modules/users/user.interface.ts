/** Team user row (tb_user — decision 74: evolution of tb_admin_account).
 *  `passwordHash` never leaves the repository layer. Created directly by an
 *  Admin (decision 75); what they can do is decided by privilege grants,
 *  not by a role (decision 70). */
export interface UserRow {
  id: number
  name: string
  email: string
  active: 'S' | 'N'
  locale: string | null
  lastLoginAt: string | null
}

export interface UserInput {
  name: string
  email: string
  active: 'S' | 'N'
  locale: string | null
  /** Omitted/undefined on update = keep the current password. */
  password?: string
}

/** One screen of the privilege matrix (GET /api/users/:id/privileges). */
export interface UserInterfacePrivileges {
  interfaceId: number
  interfaceKey: string
  description: string
  groupDefault: string
  privileges: { privilegeId: number; description: string; granted: boolean }[]
}
