/**
 * Environment access for security-critical values (finding A2 in
 * AI/docs/plans/plano-seguranca.md). `process.env.JWT_SECRET ?? ''` let a
 * missing variable silently accept tokens signed with the empty string —
 * this module makes absence loud instead.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not configured')
  }
  return secret
}

/** Boot-time validation — called by server.ts before listening. */
export function assertRequiredEnv(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('Refusing to start in production without JWT_SECRET')
  }
}
