export interface AuthenticatedUser {
  userId: number
  role: 'denunciante' | 'helper' | 'policial' | 'admin'
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

export {}
