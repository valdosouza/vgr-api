export interface AuthenticatedUser {
  userId: number
  // Amendment (task 27): was 'denunciante' | 'helper' | 'policial' | 'admin'
  // — a pre-decision-17 leftover, inconsistent with the English-only code
  // rule and with @modules/identity/identity.interface.ts's Role values
  // (nothing else in src referenced the old Portuguese literals).
  role: 'anonymous' | 'reporter' | 'helper' | 'police' | 'admin'
  /** Session version claim (decision 112) — compared against
   *  tb_user.session_version on every request; absent on pre-S2 tokens,
   *  which are therefore rejected once S2 ships. */
  sv?: number
}

declare global {
  namespace Express {
    interface Request {
      /** Panel plane (tb_user) — set by authMiddleware. */
      user?: AuthenticatedUser
      /** App plane (tb_user_account) — set by appAuthMiddleware. The two
       *  are never both set: the planes are cross-rejected (decision 119). */
      appAccountId?: number
    }
  }
}

export {}
