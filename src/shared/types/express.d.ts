export interface AuthenticatedUser {
  userId: number
  // Amendment (task 27): was 'denunciante' | 'helper' | 'policial' | 'admin'
  // — a pre-decision-17 leftover, inconsistent with the English-only code
  // rule and with @modules/identity/identity.interface.ts's Role values
  // (nothing else in src referenced the old Portuguese literals).
  role: 'anonymous' | 'reporter' | 'helper' | 'police' | 'admin'
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

export {}
