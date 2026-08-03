/** Login row over tb_user (decision 74 — AdminAccount evolved into the team
 *  user; decision 67's no-self-registration rule still holds: accounts are
 *  created by an Admin on the Users screen, decision 75).
 *  `passwordHash` never leaves this module (no DTO/controller serializes it). */
export interface AdminAccountRow {
  id: number
  email: string
  passwordHash: string
  active: 'S' | 'N'
  /** Stamped into the JWT; bumping it revokes every session (decision 112). */
  sessionVersion: number
  /** Progressive-delay counter (decision 113) — resets on success. */
  failedLoginCount: number
  /** Envelope-encrypted base32 TOTP secret (decisions 111/114); null until
   *  enrollment starts. */
  totpSecret: string | null
  /** 'S' once the user confirmed a code — from then on login requires TOTP. */
  totpEnabled: 'S' | 'N'
}
