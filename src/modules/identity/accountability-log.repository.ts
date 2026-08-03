import pool from '@shared/db/connection'

/**
 * Append-only — intentionally has no find/list export. Every anonymous
 * Report/HelpOffer submission calls this (wired in by tasks 03/06, not
 * yet implemented); this repository only guarantees the write side and
 * that nothing here is ever readable through a public-facing route.
 */
export async function appendAccountabilityLogEntry(
  actionType: string,
  ipAddress: string,
  metadata: Record<string, unknown> | null
): Promise<void> {
  await pool.query(`INSERT INTO tb_accountability_log (action_type, ip_address, metadata) VALUES (?, ?, ?)`, [
    actionType,
    ipAddress,
    metadata === null ? null : JSON.stringify(metadata),
  ])
}
