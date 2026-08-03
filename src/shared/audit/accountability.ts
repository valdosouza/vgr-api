import pool from '@shared/db/connection'
import { encryptEnvelope } from '@shared/crypto/envelope'

/**
 * Append-only accountability trail for anonymous actions (decision 23) —
 * anonymity is social/interface-level, never forensic. Promoted from
 * modules/identity to shared when SubmitReport became its second caller
 * (E8 of the report-front amendments; modules never import each other).
 *
 * Intentionally has no find/list export. ip_address and metadata are
 * envelope-encrypted at write time (decisions 44/111): a leaked database
 * alone exposes nothing. The only legitimate read path is the
 * dual-control flow of decision 45, which does its own decrypting.
 */
export async function appendAccountabilityLogEntry(
  actionType: string,
  ipAddress: string,
  metadata: Record<string, unknown> | null
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_accountability_log (action_type, ip_address, metadata) VALUES (?, ?, ?)`,
    [
      actionType,
      encryptEnvelope(ipAddress),
      metadata === null ? null : encryptEnvelope(JSON.stringify(metadata)),
    ]
  )
}
