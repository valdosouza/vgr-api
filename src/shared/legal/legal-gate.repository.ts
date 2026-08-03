import pool from '@shared/db/connection'
import {
  ActiveRuleRow,
  AuditEntry,
  JurisdictionRow,
  OperationalState,
} from '@shared/legal/legal-gate.interface'

/**
 * Raw lookups for the Legal Gate. Lives in @shared (not in the
 * legal-policy module) because the gate is consumed by the gateway
 * middleware and, later, by report/reward/panic services — and modules
 * never import each other (ARCHITECTURE.md).
 */

export async function findJurisdiction(code: string): Promise<JurisdictionRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT code, name, operational_state AS operationalState, is_sandbox AS isSandbox,
            pending_state AS pendingState, pending_by AS pendingBy
     FROM tb_jurisdiction
     WHERE code = ? AND deleted = 'N'`,
    [code]
  )
  if (!rows[0]) return null
  return {
    code: rows[0].code,
    name: rows[0].name,
    operationalState: rows[0].operationalState as OperationalState,
    isSandbox: rows[0].isSandbox === 'S',
    pendingState: rows[0].pendingState ?? null,
    pendingBy: rows[0].pendingBy ?? null,
  }
}

/** Latest ACTIVE rule for capability x jurisdiction. Expiry is judged by
 *  the service (decision 108), not filtered here — an expired row must be
 *  visible to it so "expired" and "never reviewed" audit the same way. */
export async function findActiveRule(
  capability: string,
  jurisdictionCode: string
): Promise<ActiveRuleRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, capability, jurisdiction_code AS jurisdictionCode, version, status,
            reason, review_state AS reviewState, expires_at AS expiresAt
     FROM tb_legal_rule
     WHERE capability = ? AND jurisdiction_code = ? AND rule_state = 'active' AND deleted = 'N'
     ORDER BY version DESC
     LIMIT 1`,
    [capability, jurisdictionCode]
  )
  if (!rows[0]) return null
  return {
    ...rows[0],
    reason: rows[0].reason ?? null,
    expiresAt: rows[0].expiresAt ? new Date(rows[0].expiresAt) : null,
  }
}

/** Append-only (plan L6) — this module intentionally has no update/delete. */
export async function insertAudit(entry: AuditEntry): Promise<void> {
  await pool.query(
    `INSERT INTO tb_legal_gate_audit
       (capability, jurisdiction_code, rule_id, rule_version, outcome, reason, user_ref, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.capability,
      entry.jurisdictionCode,
      entry.ruleId,
      entry.ruleVersion,
      entry.outcome,
      entry.reason,
      entry.userRef,
      entry.ip,
    ]
  )
}
