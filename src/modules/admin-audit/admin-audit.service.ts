import * as repository from '@modules/admin-audit/admin-audit.repository'
import {
  AuditEntry,
  AuditEntryRow,
  AuditFacets,
  AuditListFilters,
  AuditListItem,
  AuditListRow,
  AuditPage,
} from '@modules/admin-audit/admin-audit.interface'
import { AuditListQuery } from '@modules/admin-audit/admin-audit.dto'
import { AuditAction } from '@shared/audit/audit-action'
import { toDateBounds } from '@shared/http/query-date'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * Trail READ (B5 — decisions 116/165/166). Three read operations and
 * nothing else: the trail is append-only and this module never writes.
 * Reading it is NOT audited (166) — that would be recursive and would
 * drown the trail; the controller therefore never calls auditFromRequest.
 */

/** The stored summary is served AS STORED: parsed when it is valid JSON
 *  (it always is when written by auditAdminAction — already
 *  secret-redacted at write time, decision 110), the raw string
 *  otherwise. Never re-interpreted beyond JSON.parse. */
function parseSummary(summary: string | null): unknown | null {
  if (summary === null) return null
  try {
    return JSON.parse(summary)
  } catch {
    return summary
  }
}

/** The ONE mapping from a row to a list item — no ip, by construction. */
function toListItem(row: AuditListRow): AuditListItem {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    action: row.action as AuditAction,
    entity: row.entity,
    entityId: row.entityId,
    summary: parseSummary(row.summary),
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

function toEntry(row: AuditEntryRow): AuditEntry {
  return { ...toListItem(row), ip: row.ip }
}

export async function listAuditEntries(query: AuditListQuery): Promise<AuditPage> {
  const filters: AuditListFilters = {
    ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.entity === undefined ? {} : { entity: query.entity }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
    ...toDateBounds(query),
  }

  const { rows, total } = await repository.listAuditEntries(filters, query.page, query.pageSize)
  return { items: rows.map(toListItem), page: query.page, pageSize: query.pageSize, total }
}

/** The only place the operator `ip` leaves the API. */
export async function getAuditEntry(id: number): Promise<AuditEntry> {
  const row = await repository.findAuditEntryById(id)
  if (!row) throw new HttpError(404, 'Audit entry not found', undefined, ErrorCodes.NOT_FOUND)
  return toEntry(row)
}

export async function getAuditFacets(): Promise<AuditFacets> {
  return repository.listAuditFacets()
}
