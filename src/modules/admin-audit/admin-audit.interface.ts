import { AuditAction } from '@shared/audit/audit-action'

/**
 * Read side of the administrative trail (B5 — decisions 116/165/166).
 * Rows are what the repository projects (camelCase aliases in SQL);
 * items are what the panel receives. `ip` is personal data and exists
 * ONLY in the single-entry shapes — the list never carries it.
 */

/** Filters resolved by the service; every one optional. */
export interface AuditListFilters {
  actorId?: number
  action?: AuditAction
  entity?: string
  entityId?: string
  createdFrom?: Date
  createdTo?: Date
  /** true when `to` was date-only (next-midnight bound, `<`). */
  createdToExclusive?: boolean
}

/** List projection — no ip. `actorName` comes from a LEFT JOIN on
 *  tb_user (null when the user row is gone; the id still names it). */
export interface AuditListRow {
  id: number
  actorId: number
  actorName: string | null
  action: string
  entity: string
  entityId: string | null
  /** As stored: the JSON text written by auditAdminAction (already
   *  secret-redacted, decision 110) — or null. */
  summary: string | null
  createdAt: Date
}

export interface AuditEntryRow extends AuditListRow {
  ip: string | null
}

export interface AuditListItem {
  id: number
  actorId: number
  actorName: string | null
  action: AuditAction
  entity: string
  entityId: string | null
  /** Parsed JSON when the stored text parses, else the raw string, else
   *  null. Served as stored — never re-interpreted by the API. */
  summary: unknown | null
  createdAt: string
}

export interface AuditEntry extends AuditListItem {
  ip: string | null
}

export interface AuditPage {
  items: AuditListItem[]
  page: number
  pageSize: number
  total: number
}

/** DISTINCT values present in the table — the screen's dropdowns. */
export interface AuditFacets {
  actions: string[]
  entities: string[]
}
