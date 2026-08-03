import pool from '@shared/db/connection'
import { encryptEnvelope } from '@shared/crypto/envelope'

/**
 * Append-only — intentionally has no find/list export. Every anonymous
 * Report/HelpOffer submission calls this (wired in by tasks 03/06, not
 * yet implemented); this repository only guarantees the write side and
 * that nothing here is ever readable through a public-facing route.
 *
 * ip_address and metadata are envelope-encrypted at write time (decisions
 * 44/111): a leaked database alone exposes nothing. Decryption is NOT
 * exported here — the only legitimate read path is the dual-control flow
 * of decision 45, which does its own decrypting when that view is built.
 */
export async function appendAccountabilityLogEntry(
  actionType: string,
  ipAddress: string,
  metadata: Record<string, unknown> | null
): Promise<void> {
  await pool.query(`INSERT INTO tb_accountability_log (action_type, ip_address, metadata) VALUES (?, ?, ?)`, [
    actionType,
    encryptEnvelope(ipAddress),
    metadata === null ? null : encryptEnvelope(JSON.stringify(metadata)),
  ])
}
