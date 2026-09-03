import pool from '@shared/db/connection'
import { MediaRow } from '@modules/media/media.interface'
import { ModerationReason } from '@shared/moderation/moderation-reason'

const MEDIA_SELECT = `
  SELECT id, public_id AS publicId, class, uploader_account_id AS uploaderAccountId,
         status, mime_original AS mimeOriginal, mime,
         bytes_original AS bytesOriginal, bytes, width, height,
         sha256_original AS sha256Original, sha256,
         storage_prefix AS storagePrefix, keep_original AS keepOriginal,
         exif_warning_version AS exifWarningVersion, dek_wrapped AS dekWrapped,
         expires_at AS expiresAt, frozen,
         blocked_reason_code AS blockedReasonCode, blocked_note AS blockedNote,
         blocked_at AS blockedAt, blocked_by AS blockedBy
  FROM tb_media`

function toMedia(row: any): MediaRow {
  return {
    id: row.id,
    publicId: row.publicId,
    class: row.class,
    uploaderAccountId: row.uploaderAccountId ?? null,
    status: row.status,
    mimeOriginal: row.mimeOriginal,
    mime: row.mime,
    bytesOriginal: row.bytesOriginal,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    sha256Original: row.sha256Original,
    sha256: row.sha256,
    storagePrefix: row.storagePrefix,
    keepOriginal: row.keepOriginal === 'S',
    exifWarningVersion: row.exifWarningVersion ?? null,
    dekWrapped: row.dekWrapped ?? null,
    expiresAt: row.expiresAt ?? null,
    frozen: row.frozen === 'S',
    blockedReasonCode: row.blockedReasonCode ?? null,
    blockedNote: row.blockedNote ?? null,
    blockedAt: row.blockedAt ?? null,
    blockedBy: row.blockedBy ?? null,
  }
}

export async function insertMedia(input: {
  publicId: string
  class: string
  uploaderAccountId: number | null
  status: string
  mimeOriginal: string
  mime: string
  bytesOriginal: number
  bytes: number
  width: number
  height: number
  sha256Original: string
  sha256: string
  storagePrefix: string
  keepOriginal: boolean
  exifWarningVersion: string | null
  dekWrapped: string
}): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_media
       (public_id, class, uploader_account_id, status, mime_original, mime,
        bytes_original, bytes, width, height, sha256_original, sha256,
        storage_prefix, keep_original, exif_warning_version, dek_wrapped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.publicId,
      input.class,
      input.uploaderAccountId,
      input.status,
      input.mimeOriginal,
      input.mime,
      input.bytesOriginal,
      input.bytes,
      input.width,
      input.height,
      input.sha256Original,
      input.sha256,
      input.storagePrefix,
      input.keepOriginal ? 'S' : 'N',
      input.exifWarningVersion,
      input.dekWrapped,
    ]
  )
  return result.insertId
}

export async function findByPublicId(publicId: string): Promise<MediaRow | null> {
  const [rows] = await pool.query<any[]>(
    `${MEDIA_SELECT} WHERE public_id = ? AND deleted = 'N'`,
    [publicId]
  )
  return rows[0] ? toMedia(rows[0]) : null
}

/**
 * Block (B2, decision 162): atomic available -> blocked — 0 rows = the
 * status moved meanwhile. The DEK is NOT touched: a moderation hold
 * preserves evidence for an authority (M3 — the panel keeps reading it);
 * only the shred of decision 131 ever clears it. Retention and freeze
 * are not moderation's either.
 */
export async function blockMedia(
  id: number,
  reasonCode: ModerationReason,
  note: string | null,
  actorId: number
): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_media
     SET status = 'blocked', blocked_reason_code = ?, blocked_note = ?, blocked_at = NOW(), blocked_by = ?
     WHERE id = ? AND status = 'available' AND deleted = 'N'`,
    [reasonCode, note, actorId, id]
  )
  return result.affectedRows > 0
}

/** Unblock (162): atomic blocked -> available, clearing the four columns —
 *  the reason for reverting lives in tb_admin_audit. */
export async function unblockMedia(id: number): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_media
     SET status = 'available', blocked_reason_code = NULL, blocked_note = NULL, blocked_at = NULL, blocked_by = NULL
     WHERE id = ? AND status = 'blocked' AND deleted = 'N'`,
    [id]
  )
  return result.affectedRows > 0
}

/** Crypto-shredding (decision 131): clearing the wrapped DEK IS the
 *  deletion — storage objects become unrecoverable noise, backups
 *  included. The storage delete that follows is cost hygiene, not the
 *  security boundary. */
export async function shred(id: number): Promise<void> {
  await pool.query(
    `UPDATE tb_media SET dek_wrapped = NULL, status = 'deleted', deleted = 'S' WHERE id = ?`,
    [id]
  )
}

/** Due for the retention job. Two rulers, one job (decisions 131/136):
 *  stamped expiry reached (case resolved 90 days ago), OR an orphan —
 *  'pending' that no attach ever consumed, older than the configured TTL.
 *  Never frozen (a case in an authority's hands never expires). */
export async function findExpired(
  limit: number,
  orphanTtlHours: number
): Promise<Array<{ id: number; storagePrefix: string; keepOriginal: boolean }>> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, storage_prefix AS storagePrefix, keep_original AS keepOriginal
     FROM tb_media
     WHERE deleted = 'N' AND status <> 'deleted' AND frozen = 'N'
       AND ((expires_at IS NOT NULL AND expires_at <= NOW())
         OR (status = 'pending' AND created_at <= NOW() - INTERVAL ? HOUR))
     ORDER BY id
     LIMIT ?`,
    [orphanTtlHours, limit]
  )
  return rows.map((row) => ({
    id: row.id,
    storagePrefix: row.storagePrefix,
    keepOriginal: row.keepOriginal === 'S',
  }))
}
