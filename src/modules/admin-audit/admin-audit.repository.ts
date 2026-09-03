import pool from '@shared/db/connection'
import {
  AuditEntryRow,
  AuditFacets,
  AuditListFilters,
  AuditListRow,
} from '@modules/admin-audit/admin-audit.interface'

/**
 * READ-ONLY access to tb_admin_audit (B5 — decision 116: the trail is
 * append-only; the only writer is shared/audit/admin-audit.ts and it
 * only INSERTs). This file issues SELECTs and nothing else — a guard in
 * its spec asserts it.
 *
 * The actor's name comes from a LEFT JOIN on tb_user WITHOUT any
 * deleted/active filter: a trail must not lose its actor when the user
 * row is soft-deleted (the id is always there; the name is a courtesy).
 * `ip` is personal data: projected by findAuditEntryById ONLY.
 */

const LIST_SELECT = `SELECT a.id, a.actor_id AS actorId, u.name AS actorName, a.action, a.entity,
            a.entity_id AS entityId, a.summary, a.created_at AS createdAt
     FROM tb_admin_audit a
     LEFT JOIN tb_user u ON u.id = a.actor_id`

const ENTRY_SELECT = `SELECT a.id, a.actor_id AS actorId, u.name AS actorName, a.action, a.entity,
            a.entity_id AS entityId, a.summary, a.ip, a.created_at AS createdAt
     FROM tb_admin_audit a
     LEFT JOIN tb_user u ON u.id = a.actor_id`

function buildWhere(filters: AuditListFilters): { whereSql: string; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []

  if (filters.actorId !== undefined) {
    where.push('a.actor_id = ?')
    params.push(filters.actorId)
  }
  if (filters.action !== undefined) {
    where.push('a.action = ?')
    params.push(filters.action)
  }
  if (filters.entity !== undefined) {
    where.push('a.entity = ?')
    params.push(filters.entity)
  }
  if (filters.entityId !== undefined) {
    where.push('a.entity_id = ?')
    params.push(filters.entityId)
  }
  if (filters.createdFrom !== undefined) {
    where.push('a.created_at >= ?')
    params.push(filters.createdFrom)
  }
  if (filters.createdTo !== undefined) {
    where.push(filters.createdToExclusive ? 'a.created_at < ?' : 'a.created_at <= ?')
    params.push(filters.createdTo)
  }

  return { whereSql: where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '', params }
}

function toListRow(row: any): AuditListRow {
  return {
    id: Number(row.id),
    actorId: Number(row.actorId),
    actorName: row.actorName ?? null,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId ?? null,
    summary: row.summary ?? null,
    createdAt: row.createdAt,
  }
}

/** Newest first, id as tiebreaker (decision 116: the trail reads as a
 *  timeline). Count first; an empty page never runs the SELECT. */
export async function listAuditEntries(
  filters: AuditListFilters,
  page: number,
  pageSize: number
): Promise<{ rows: AuditListRow[]; total: number }> {
  const { whereSql, params } = buildWhere(filters)

  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_admin_audit a${whereSql}`,
    params
  )
  const total = Number(countRows[0]?.total ?? 0)
  if (total === 0) return { rows: [], total }

  const [rows] = await pool.query<any[]>(
    `${LIST_SELECT}${whereSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  )
  return { rows: rows.map(toListRow), total }
}

export async function findAuditEntryById(id: number): Promise<AuditEntryRow | null> {
  const [rows] = await pool.query<any[]>(`${ENTRY_SELECT} WHERE a.id = ?`, [id])
  if (rows.length === 0) return null
  return { ...toListRow(rows[0]), ip: rows[0].ip ?? null }
}

/** DISTINCT values present in the table — what the screen offers in its
 *  dropdowns (the action union is fixed in code, but only the values
 *  that actually occurred are useful as filters). */
export async function listAuditFacets(): Promise<AuditFacets> {
  const [actionRows] = await pool.query<any[]>(
    `SELECT DISTINCT action FROM tb_admin_audit ORDER BY action`
  )
  const [entityRows] = await pool.query<any[]>(
    `SELECT DISTINCT entity FROM tb_admin_audit ORDER BY entity`
  )
  return {
    actions: actionRows.map((row) => String(row.action)),
    entities: entityRows.map((row) => String(row.entity)),
  }
}
