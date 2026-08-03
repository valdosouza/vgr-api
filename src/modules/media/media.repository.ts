import pool from '@shared/db/connection'
import { MediaRow } from '@modules/media/media.interface'

const MEDIA_SELECT = `
  SELECT id, public_id AS publicId, class, uploader_account_id AS uploaderAccountId,
         status, mime_original AS mimeOriginal, mime,
         bytes_original AS bytesOriginal, bytes, width, height,
         sha256_original AS sha256Original, sha256,
         storage_prefix AS storagePrefix, keep_original AS keepOriginal,
         exif_warning_version AS exifWarningVersion, dek_wrapped AS dekWrapped,
         expires_at AS expiresAt, frozen
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
