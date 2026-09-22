import pool from '@shared/db/connection'
import {
  CapabilityOverviewRow,
  JurisdictionAdminRow,
  LegalRuleProposal,
  LegalRuleRow,
} from '@modules/legal-policy/legal-policy.interface'
import { OperationalState } from '@shared/legal/legal-gate.interface'
import { LIMIT_OFFSET_SQL, PageWindow, limitOffsetArgs } from '@shared/http/paged-query'

/** Text filter (PS0, decision 220): one LIKE per listed column, parameterized. */
function likeClause(columns: string[], filter?: string): { sql: string; params: string[] } {
  if (!filter) return { sql: '', params: [] }
  return {
    sql: ` AND (${columns.map((column) => `${column} LIKE ?`).join(' OR ')})`,
    params: columns.map(() => `%${filter}%`),
  }
}

function windowClause(window?: PageWindow): { sql: string; params: number[] } {
  return window ? { sql: ` ${LIMIT_OFFSET_SQL}`, params: limitOffsetArgs(window) } : { sql: '', params: [] }
}

function toRuleRow(row: any): LegalRuleRow {
  return {
    id: row.id,
    capability: row.capability,
    jurisdictionCode: row.jurisdictionCode,
    version: row.version,
    status: row.status,
    reason: row.reason ?? null,
    legalBasis: row.legalBasis ?? null,
    reviewState: row.reviewState,
    ruleState: row.ruleState,
    effectiveFrom: row.effectiveFrom ? new Date(row.effectiveFrom) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    proposedBy: row.proposedBy,
    approvedBy: row.approvedBy ?? null,
    createdAt: new Date(row.createdAt),
    decidedAt: row.decidedAt ? new Date(row.decidedAt) : null,
  }
}

const RULE_SELECT = `
  SELECT id, capability, jurisdiction_code AS jurisdictionCode, version, status, reason,
         legal_basis AS legalBasis, review_state AS reviewState, rule_state AS ruleState,
         effective_from AS effectiveFrom, expires_at AS expiresAt,
         proposed_by AS proposedBy, approved_by AS approvedBy,
         created_at AS createdAt, decided_at AS decidedAt
  FROM tb_legal_rule`

/** No window = the legacy unpaged list (decision 220 keeps it intact). */
export async function listJurisdictions(
  filter?: string,
  window?: PageWindow
): Promise<JurisdictionAdminRow[]> {
  const where = likeClause(['code', 'name'], filter)
  const limit = windowClause(window)
  const [rows] = await pool.query<any[]>(
    `SELECT code, name, operational_state AS operationalState, is_sandbox AS isSandbox,
            pending_state AS pendingState, pending_by AS pendingBy
     FROM tb_jurisdiction WHERE deleted = 'N'${where.sql} ORDER BY code${limit.sql}`,
    [...where.params, ...limit.params]
  )
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    operationalState: row.operationalState,
    isSandbox: row.isSandbox === 'S',
    pendingState: row.pendingState ?? null,
    pendingBy: row.pendingBy ?? null,
  }))
}

export async function countJurisdictions(filter?: string): Promise<number> {
  const where = likeClause(['code', 'name'], filter)
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_jurisdiction WHERE deleted = 'N'${where.sql}`,
    where.params
  )
  return Number(rows[0]?.total ?? 0)
}

export async function findJurisdictionByCode(code: string): Promise<JurisdictionAdminRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT code, name, operational_state AS operationalState, is_sandbox AS isSandbox,
            pending_state AS pendingState, pending_by AS pendingBy
     FROM tb_jurisdiction WHERE code = ? AND deleted = 'N'`,
    [code]
  )
  if (!rows[0]) return null
  return {
    code: rows[0].code,
    name: rows[0].name,
    operationalState: rows[0].operationalState,
    isSandbox: rows[0].isSandbox === 'S',
    pendingState: rows[0].pendingState ?? null,
    pendingBy: rows[0].pendingBy ?? null,
  }
}

export async function applyOperationalState(code: string, state: OperationalState): Promise<void> {
  await pool.query(
    `UPDATE tb_jurisdiction
     SET operational_state = ?, pending_state = NULL, pending_by = NULL
     WHERE code = ?`,
    [state, code]
  )
}

export async function setPendingState(
  code: string,
  state: OperationalState,
  proposerId: number
): Promise<void> {
  await pool.query(`UPDATE tb_jurisdiction SET pending_state = ?, pending_by = ? WHERE code = ?`, [
    state,
    proposerId,
    code,
  ])
}

export interface RuleListFilters {
  capability?: string
  jurisdictionCode?: string
  /** Text filter (decision 220) on capability / jurisdiction_code / legal_basis. */
  filter?: string
}

function ruleWhere(filters: RuleListFilters): { sql: string; params: string[] } {
  const clauses: string[] = [`deleted = 'N'`]
  const params: string[] = []
  if (filters.capability) {
    clauses.push('capability = ?')
    params.push(filters.capability)
  }
  if (filters.jurisdictionCode) {
    clauses.push('jurisdiction_code = ?')
    params.push(filters.jurisdictionCode)
  }
  const like = likeClause(['capability', 'jurisdiction_code', 'legal_basis'], filters.filter)
  return { sql: ` WHERE ${clauses.join(' AND ')}${like.sql}`, params: [...params, ...like.params] }
}

/** No window = the legacy unpaged list (decision 220 keeps it intact). */
export async function listRules(filters: RuleListFilters, window?: PageWindow): Promise<LegalRuleRow[]> {
  const where = ruleWhere(filters)
  const limit = windowClause(window)
  const [rows] = await pool.query<any[]>(
    `${RULE_SELECT}${where.sql}
     ORDER BY capability, jurisdiction_code, version DESC${limit.sql}`,
    [...where.params, ...limit.params]
  )
  return rows.map(toRuleRow)
}

export async function countRules(filters: RuleListFilters): Promise<number> {
  const where = ruleWhere(filters)
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_legal_rule${where.sql}`,
    where.params
  )
  return Number(rows[0]?.total ?? 0)
}

export async function findRuleById(id: number): Promise<LegalRuleRow | null> {
  const [rows] = await pool.query<any[]>(`${RULE_SELECT} WHERE id = ? AND deleted = 'N'`, [id])
  return rows[0] ? toRuleRow(rows[0]) : null
}

export async function findOpenProposal(
  capability: string,
  jurisdictionCode: string
): Promise<LegalRuleRow | null> {
  const [rows] = await pool.query<any[]>(
    `${RULE_SELECT} WHERE capability = ? AND jurisdiction_code = ?
       AND rule_state = 'proposed' AND deleted = 'N' LIMIT 1`,
    [capability, jurisdictionCode]
  )
  return rows[0] ? toRuleRow(rows[0]) : null
}

export async function findActiveAllowedRule(
  capability: string,
  jurisdictionCode: string
): Promise<LegalRuleRow | null> {
  const [rows] = await pool.query<any[]>(
    `${RULE_SELECT} WHERE capability = ? AND jurisdiction_code = ?
       AND rule_state = 'active' AND status = 'allowed'
       AND (expires_at IS NULL OR expires_at > NOW()) AND deleted = 'N'
     ORDER BY version DESC LIMIT 1`,
    [capability, jurisdictionCode]
  )
  return rows[0] ? toRuleRow(rows[0]) : null
}

export async function insertProposal(
  proposal: LegalRuleProposal,
  proposerId: number
): Promise<number> {
  const [versionRows] = await pool.query<any[]>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion
     FROM tb_legal_rule WHERE capability = ? AND jurisdiction_code = ?`,
    [proposal.capability, proposal.jurisdictionCode]
  )
  const [result] = await pool.query<any>(
    `INSERT INTO tb_legal_rule
       (capability, jurisdiction_code, version, status, reason, legal_basis,
        review_state, rule_state, expires_at, proposed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', DATE_ADD(NOW(), INTERVAL ? DAY), ?)`,
    [
      proposal.capability,
      proposal.jurisdictionCode,
      versionRows[0].nextVersion,
      proposal.status,
      proposal.reason,
      proposal.legalBasis,
      proposal.reviewState,
      proposal.expiresInDays,
      proposerId,
    ]
  )
  return result.insertId
}

/** Activation is transactional: the previous active version is superseded
 *  in the same commit — there is never zero or two active rules visible. */
export async function activateRule(id: number, rule: LegalRuleRow, approverId: number): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `UPDATE tb_legal_rule SET rule_state = 'superseded'
       WHERE capability = ? AND jurisdiction_code = ? AND rule_state = 'active'`,
      [rule.capability, rule.jurisdictionCode]
    )
    await conn.query(
      `UPDATE tb_legal_rule
       SET rule_state = 'active', approved_by = ?, effective_from = NOW(), decided_at = NOW()
       WHERE id = ?`,
      [approverId, id]
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export async function rejectRule(id: number, actorId: number): Promise<void> {
  await pool.query(
    `UPDATE tb_legal_rule SET rule_state = 'rejected', approved_by = ?, decided_at = NOW()
     WHERE id = ?`,
    [actorId, id]
  )
}

const CAPABILITY_TEXT_COLUMNS = ['c.capability', 'c.description']

/** Catalog + the current active rule per capability for one jurisdiction.
 *  No window = the legacy unpaged list (decision 220 keeps it intact). */
export async function listCapabilityOverview(
  jurisdictionCode: string,
  filter?: string,
  window?: PageWindow
): Promise<CapabilityOverviewRow[]> {
  const where = likeClause(CAPABILITY_TEXT_COLUMNS, filter)
  const limit = windowClause(window)
  const [rows] = await pool.query<any[]>(
    `SELECT c.capability, c.description, c.module,
            r.id AS ruleId, r.version AS ruleVersion, r.status AS ruleStatus,
            r.reason AS ruleReason, r.review_state AS ruleReviewState, r.expires_at AS ruleExpiresAt
     FROM tb_legal_capability c
     LEFT JOIN tb_legal_rule r
       ON r.capability = c.capability AND r.jurisdiction_code = ?
      AND r.rule_state = 'active' AND r.deleted = 'N'
      AND (r.expires_at IS NULL OR r.expires_at > NOW())
     WHERE c.deleted = 'N'${where.sql}
     ORDER BY c.module, c.capability${limit.sql}`,
    [jurisdictionCode, ...where.params, ...limit.params]
  )
  return rows.map((row) => ({
    capability: row.capability,
    description: row.description,
    module: row.module,
    effectiveStatus: row.ruleStatus ?? 'unreviewed',
    activeRule: row.ruleId
      ? {
          id: row.ruleId,
          version: row.ruleVersion,
          status: row.ruleStatus,
          reason: row.ruleReason ?? null,
          reviewState: row.ruleReviewState,
          expiresAt: row.ruleExpiresAt ? new Date(row.ruleExpiresAt) : null,
        }
      : null,
  }))
}

/** The overview is one row per catalog entry (LEFT JOIN), so its total is
 *  the catalog count — independent of the jurisdiction. */
export async function countCapabilities(filter?: string): Promise<number> {
  const where = likeClause(CAPABILITY_TEXT_COLUMNS, filter)
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_legal_capability c WHERE c.deleted = 'N'${where.sql}`,
    where.params
  )
  return Number(rows[0]?.total ?? 0)
}

/** Migration-022 catalog keys — the sync spec compares them with the TS
 *  catalog (decision 103). */
export async function listCapabilityKeys(): Promise<string[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT capability FROM tb_legal_capability WHERE deleted = 'N' ORDER BY capability`
  )
  return rows.map((row) => row.capability)
}
