/** No self-registration — rows are seeded/created manually (decision 67).
 *  `passwordHash` never leaves this module (no DTO/controller serializes it). */
export interface AdminAccountRow {
  id: number
  email: string
  passwordHash: string
}
