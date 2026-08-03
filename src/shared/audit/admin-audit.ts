import { Request } from 'express'
import pool from '@shared/db/connection'
import logger from '@shared/logger/logger'

/**
 * Administrative audit trail (decision 116, SEC-6) — who did what, when,
 * from where, on every mutating admin endpoint. Fire-and-forget in the
 * same pattern as the Legal Gate audit: a failed audit write never takes
 * the action down with it, but it is never silent either.
 *
 * Called from CONTROLLERS after a successful mutation (implementation
 * note on decision 116): the actor and IP live at the HTTP layer, and
 * threading them through every service signature would spread transport
 * context into the domain for no gain.
 */

export type AuditAction = 'create' | 'update' | 'delete' | 'grant' | 'state_change'

/** Decision 110: no secret ever reaches a log — this table included. */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      clean[key] = /password|secret|token|key/i.test(key) ? '[redacted]' : sanitize(entry)
    }
    return clean
  }
  return value
}

export function auditAdminAction(entry: {
  actorId: number
  action: AuditAction
  entity: string
  entityId?: string | number
  summary?: unknown
  ip?: string
}): void {
  pool
    .query(
      `INSERT INTO tb_admin_audit (actor_id, action, entity, entity_id, summary, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.actorId,
        entry.action,
        entry.entity,
        entry.entityId === undefined ? null : String(entry.entityId),
        entry.summary === undefined ? null : JSON.stringify(sanitize(entry.summary)),
        entry.ip ?? null,
      ]
    )
    .catch((err) => logger.error('Admin audit write failed', { err, entry: { ...entry, summary: undefined } }))
}

/** Controller convenience — actor and IP straight from the request. */
export function auditFromRequest(
  req: Request,
  action: AuditAction,
  entity: string,
  entityId?: string | number,
  summary?: unknown
): void {
  if (!req.user) return
  auditAdminAction({
    actorId: req.user.userId,
    action,
    entity,
    entityId,
    summary,
    ip: req.ip,
  })
}
