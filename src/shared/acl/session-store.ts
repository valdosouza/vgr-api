import pool from '@shared/db/connection'

/**
 * Per-user session validity lookup (decision 112) — same TTL-cache
 * philosophy as privilege-store: DB is the source of truth, the 60s cache
 * keeps per-request cost near zero, and mutations invalidate explicitly.
 * A token is only as alive as its session_version: bumping the version in
 * tb_user kills every outstanding JWT of that user within the TTL.
 */

const TTL_MS = 60_000

interface SessionInfo {
  sessionVersion: number
  active: boolean
}

const cache = new Map<number, { info: SessionInfo | null; expiresAt: number }>()

export async function getSessionInfo(userId: number): Promise<SessionInfo | null> {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info
  }

  const [rows] = await pool.query<any[]>(
    `SELECT session_version AS sessionVersion, active
     FROM tb_user WHERE id = ? AND deleted = 'N'`,
    [userId]
  )
  const info: SessionInfo | null = rows[0]
    ? { sessionVersion: rows[0].sessionVersion, active: rows[0].active === 'S' }
    : null

  cache.set(userId, { info, expiresAt: Date.now() + TTL_MS })
  return info
}

/** Call after bumping session_version or toggling active. */
export function invalidateSession(userId: number): void {
  cache.delete(userId)
}

export function invalidateAllSessions(): void {
  cache.clear()
}
