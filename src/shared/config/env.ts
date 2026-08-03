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

/**
 * CORS origin allowlist (decision 115). Comma-separated CORS_ORIGIN env;
 * '*' is honored only outside production — in production a wildcard or a
 * missing value refuses boot instead (assertRequiredEnv).
 */
export function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim()
  if (!raw) {
    return process.env.NODE_ENV === 'production' ? [] : ['*']
  }
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/** Boot-time validation — called by server.ts before listening. */
export function assertRequiredEnv(): void {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.JWT_SECRET) {
    throw new Error('Refusing to start in production without JWT_SECRET')
  }
  const origins = allowedOrigins()
  if (origins.length === 0 || origins.includes('*')) {
    throw new Error(
      'Refusing to start in production without an explicit CORS_ORIGIN allowlist (decision 115)'
    )
  }
}
