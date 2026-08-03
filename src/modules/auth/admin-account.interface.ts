/** Login row over tb_user (decision 74 — AdminAccount evolved into the team
 *  user; decision 67's no-self-registration rule still holds: accounts are
 *  created by an Admin on the Users screen, decision 75).
 *  `passwordHash` never leaves this module (no DTO/controller serializes it). */
export interface AdminAccountRow {
  id: number
  email: string
  passwordHash: string
  active: 'S' | 'N'
}
