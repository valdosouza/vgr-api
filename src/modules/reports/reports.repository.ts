import pool from '@shared/db/connection'
import { Category, ReportRow, ReportStatus, Subject } from '@modules/reports/reports.interface'

const REPORT_SELECT = `
  SELECT id, client_key AS clientKey, category, free_tag AS freeTag, subject,
         detail_fields AS detailFields, lat, lng, anonymous,
         reporter_account_id AS reporterAccountId, status,
         resolved_at AS resolvedAt, expires_at AS expiresAt, frozen,
         frozen_reason AS frozenReason, frozen_at AS frozenAt, purged,
         created_at AS createdAt
  FROM tb_report`

function toReport(row: any): ReportRow {
  return {
    id: row.id,
    clientKey: row.clientKey,
    category: (row.category as Category) ?? null,
    freeTag: row.freeTag ?? null,
    subject: row.subject as Subject,
    detailFields:
      row.detailFields == null
        ? null
        : typeof row.detailFields === 'string'
          ? JSON.parse(row.detailFields)
          : row.detailFields,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    anonymous: row.anonymous === 'S',
    reporterAccountId: row.reporterAccountId ?? null,
    status: row.status as ReportStatus,
    resolvedAt: row.resolvedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    frozen: row.frozen === 'S',
    frozenReason: row.frozenReason ?? null,
    frozenAt: row.frozenAt ?? null,
    purged: row.purged === 'S',
    createdAt: row.createdAt,
  }
}

export async function findByClientKey(clientKey: string): Promise<ReportRow | null> {
  const [rows] = await pool.query<any[]>(
    `${REPORT_SELECT} WHERE client_key = ? AND deleted = 'N'`,
    [clientKey]
  )
  return rows[0] ? toReport(rows[0]) : null
}

export async function findById(id: number): Promise<ReportRow | null> {
  const [rows] = await pool.query<any[]>(`${REPORT_SELECT} WHERE id = ? AND deleted = 'N'`, [id])
  return rows[0] ? toReport(rows[0]) : null
}

export async function insertReport(input: {
  clientKey: string
  category: string | null
  freeTag: string | null
  subject: string
  detailFields: Record<string, unknown> | null
  lat: number
  lng: number
  anonymous: boolean
  reporterAccountId: number | null
}): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_report
       (client_key, category, free_tag, subject, detail_fields, lat, lng,
        anonymous, reporter_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.clientKey,
      input.category,
      input.freeTag,
      input.subject,
      input.detailFields === null ? null : JSON.stringify(input.detailFields),
      input.lat,
      input.lng,
      input.anonymous ? 'S' : 'N',
      input.reporterAccountId,
    ]
  )
  return result.insertId
}

export async function updateEditableFields(
  id: number,
  changes: { freeTag?: string; detailFields?: Record<string, unknown> }
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  if (changes.freeTag !== undefined) {
    sets.push('free_tag = ?')
    params.push(changes.freeTag)
  }
  if (changes.detailFields !== undefined) {
    sets.push('detail_fields = ?')
    params.push(JSON.stringify(changes.detailFields))
  }
  if (sets.length === 0) return
  params.push(id)
  await pool.query(`UPDATE tb_report SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** Atomic: the WHERE status='open' makes "cannot resolve twice" a race-free
 *  guarantee — 0 affected rows = it was already resolved. */
export async function markResolved(id: number, expiresAt: Date): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_report SET status = 'resolved', resolved_at = NOW(), expires_at = ?
     WHERE id = ? AND status = 'open'`,
    [expiresAt, id]
  )
  return result.affectedRows > 0
}

export async function getTimeline(
  reportId: number
): Promise<Array<{ eventType: string; payload: Record<string, unknown> | null; createdAt: Date }>> {
  const [rows] = await pool.query<any[]>(
    `SELECT event_type AS eventType, payload, created_at AS createdAt
     FROM tb_report_timeline WHERE tb_report_id = ? ORDER BY created_at, id`,
    [reportId]
  )
  return rows.map((row) => ({
    eventType: row.eventType,
    payload:
      row.payload == null
        ? null
        : typeof row.payload === 'string'
          ? JSON.parse(row.payload)
          : row.payload,
    createdAt: row.createdAt,
  }))
}

/** Offers as the OWNER's view needs them (masking happens in the service).
 *  SQL over tb_help_offer is table access, not a module import. */
export async function findOffersWithNames(
  reportId: number
): Promise<
  Array<{
    id: number
    helpType: string
    anonymous: boolean
    helperDisplayName: string | null
    createdAt: Date
  }>
> {
  const [rows] = await pool.query<any[]>(
    `SELECT o.id, o.help_type AS helpType, o.anonymous,
            a.display_name AS helperDisplayName, o.created_at AS createdAt
     FROM tb_help_offer o
     LEFT JOIN tb_user_account a ON a.id = o.helper_account_id
     WHERE o.tb_report_id = ? AND o.deleted = 'N'
     ORDER BY o.created_at, o.id`,
    [reportId]
  )
  return rows.map((row) => ({
    id: row.id,
    helpType: row.helpType,
    anonymous: row.anonymous === 'S',
    helperDisplayName: row.helperDisplayName ?? null,
    createdAt: row.createdAt,
  }))
}

/** Participant check for visibility (decisions 50/55): an IDENTIFIED
 *  offer ties the account to the case; anonymous offers cannot be
 *  recognized on read — their holders see the public view. */
export async function hasOfferByAccount(reportId: number, accountId: number): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    `SELECT 1 FROM tb_help_offer
     WHERE tb_report_id = ? AND helper_account_id = ? AND deleted = 'N' LIMIT 1`,
    [reportId, accountId]
  )
  return rows.length > 0
}

/** Freeze (decision 141a) — one human, mandatory reason. */
export async function freeze(id: number, reason: string): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_report SET frozen = 'S', frozen_reason = ?, frozen_at = NOW()
     WHERE id = ? AND frozen = 'N' AND deleted = 'N'`,
    [reason, id]
  )
  return result.affectedRows > 0
}

export async function unfreeze(id: number, newExpiresAt: Date | null): Promise<void> {
  await pool.query(
    `UPDATE tb_report SET frozen = 'N', frozen_reason = NULL, frozen_at = NULL, expires_at = ?
     WHERE id = ?`,
    [newExpiresAt, id]
  )
}

export async function insertUnfreezeRequest(
  reportId: number,
  reason: string,
  requestedBy: number
): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_report_unfreeze (tb_report_id, reason, requested_by) VALUES (?, ?, ?)`,
    [reportId, reason, requestedBy]
  )
  return result.insertId
}

export async function findPendingUnfreeze(
  reportId: number
): Promise<{ id: number; reason: string; requestedBy: number; requestedAt: Date } | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, reason, requested_by AS requestedBy, requested_at AS requestedAt
     FROM tb_report_unfreeze WHERE tb_report_id = ? AND status = 'pending'
     ORDER BY id DESC LIMIT 1`,
    [reportId]
  )
  return rows[0] ?? null
}

export async function approveUnfreezeRequest(requestId: number, approvedBy: number): Promise<void> {
  await pool.query(
    `UPDATE tb_report_unfreeze SET status = 'approved', approved_by = ?, approved_at = NOW()
     WHERE id = ?`,
    [approvedBy, requestId]
  )
}

/** Due for the purge job (decisions 25/131): expiry reached, not frozen. */
export async function findExpiredReports(limit: number): Promise<number[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM tb_report
     WHERE deleted = 'N' AND purged = 'N' AND frozen = 'N'
       AND expires_at IS NOT NULL AND expires_at <= NOW()
     ORDER BY expires_at LIMIT ?`,
    [limit]
  )
  return rows.map((row) => row.id)
}

/**
 * Purge (decisions 25/131): nulls everything sensitive — detail fields,
 * EXACT position, the free tag's text (it may name people) — keeping the
 * statistical skeleton (category/subject/status/dates). The timeline
 * payload wipe is the ONE sanctioned exception to append-only: the events
 * remain, their payloads (edit diffs, etc.) do not.
 */
export async function purgeReport(id: number): Promise<void> {
  await pool.query(
    `UPDATE tb_report
     SET detail_fields = NULL, lat = NULL, lng = NULL,
         free_tag = IF(free_tag IS NULL, NULL, '[purged]'), purged = 'S'
     WHERE id = ?`,
    [id]
  )
  await pool.query(`UPDATE tb_report_timeline SET payload = NULL WHERE tb_report_id = ?`, [id])
}

/* ------------------------------------------------------------------ *
 * Attached media (M2, decisions 128/129/134/136 — amendment E4).
 * SQL over tb_media / tb_report_media is table access, not a module
 * import (same posture as tb_help_offer above).
 * ------------------------------------------------------------------ */

/** The slice of tb_media the attach/serve flows need. */
export interface AttachableMediaRow {
  id: number
  publicId: string
  class: string
  uploaderAccountId: number | null
  status: string
  mime: string
  width: number
  height: number
  storagePrefix: string
  dekWrapped: string | null
}

const ATTACHABLE_SELECT = `
  SELECT m.id, m.public_id AS publicId, m.class,
         m.uploader_account_id AS uploaderAccountId, m.status, m.mime,
         m.width, m.height, m.storage_prefix AS storagePrefix,
         m.dek_wrapped AS dekWrapped
  FROM tb_media m`

function toAttachableMedia(row: any): AttachableMediaRow {
  return {
    id: row.id,
    publicId: row.publicId,
    class: row.class,
    uploaderAccountId: row.uploaderAccountId ?? null,
    status: row.status,
    mime: row.mime,
    width: row.width,
    height: row.height,
    storagePrefix: row.storagePrefix,
    dekWrapped: row.dekWrapped ?? null,
  }
}

export async function findMediaByPublicId(publicId: string): Promise<AttachableMediaRow | null> {
  const [rows] = await pool.query<any[]>(
    `${ATTACHABLE_SELECT} WHERE m.public_id = ? AND m.deleted = 'N'`,
    [publicId]
  )
  return rows[0] ? toAttachableMedia(rows[0]) : null
}

/** The media only if it is attached to THIS report — the serving route's
 *  scope (a publicId outside the report answers the same 404). */
export async function findAttachedMedia(
  reportId: number,
  publicId: string
): Promise<AttachableMediaRow | null> {
  const [rows] = await pool.query<any[]>(
    `${ATTACHABLE_SELECT}
     JOIN tb_report_media rm ON rm.tb_media_id = m.id AND rm.deleted = 'N'
     WHERE rm.tb_report_id = ? AND m.public_id = ? AND m.deleted = 'N'`,
    [reportId, publicId]
  )
  return rows[0] ? toAttachableMedia(rows[0]) : null
}

export async function listAttachedMedia(reportId: number): Promise<AttachableMediaRow[]> {
  const [rows] = await pool.query<any[]>(
    `${ATTACHABLE_SELECT}
     JOIN tb_report_media rm ON rm.tb_media_id = m.id AND rm.deleted = 'N'
     WHERE rm.tb_report_id = ? AND m.deleted = 'N' AND m.status = 'available'
     ORDER BY rm.id`,
    [reportId]
  )
  return rows.map(toAttachableMedia)
}

export async function isMediaLinked(reportId: number, mediaId: number): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    `SELECT 1 FROM tb_report_media
     WHERE tb_report_id = ? AND tb_media_id = ? AND deleted = 'N' LIMIT 1`,
    [reportId, mediaId]
  )
  return rows.length > 0
}

export async function countAttachedMedia(reportId: number): Promise<number> {
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_report_media WHERE tb_report_id = ? AND deleted = 'N'`,
    [reportId]
  )
  return Number(rows[0]?.total ?? 0)
}

/**
 * The attach itself (decision 134), atomic: link + consume 'pending' +
 * timeline event commit together, so a crash can never strand a media as
 * attached-but-unlinked (orphan expiry would shred live evidence) or
 * linked-but-pending (orphan-shredded while attached).
 *  - 'already_linked': the UNIQUE key collided — an offline-queue replay.
 *  - 'not_pending': someone else consumed the state first (race with a
 *    second report, or moderation moved it) — nothing was written.
 */
export async function attachMedia(
  reportId: number,
  media: { id: number; publicId: string }
): Promise<'attached' | 'already_linked' | 'not_pending'> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    try {
      await conn.query(`INSERT INTO tb_report_media (tb_report_id, tb_media_id) VALUES (?, ?)`, [
        reportId,
        media.id,
      ])
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        await conn.rollback()
        return 'already_linked'
      }
      throw err
    }
    const [claim] = await conn.query<any>(
      `UPDATE tb_media SET status = 'available' WHERE id = ? AND status = 'pending'`,
      [media.id]
    )
    if (claim.affectedRows === 0) {
      await conn.rollback()
      return 'not_pending'
    }
    await conn.query(
      `INSERT INTO tb_report_timeline (tb_report_id, event_type, payload) VALUES (?, ?, ?)`,
      [reportId, 'media_attached', JSON.stringify({ mediaPublicId: media.publicId })]
    )
    await conn.commit()
    return 'attached'
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** Resolution stamps the retention clock on the case's evidence too
 *  (decision 131 — media.md contract: "expires_at gets stamped by M2 when
 *  the owning case resolves"). */
export async function stampAttachedMediaExpiry(
  reportId: number,
  expiresAt: Date | null
): Promise<void> {
  await pool.query(
    `UPDATE tb_media m
     JOIN tb_report_media rm ON rm.tb_media_id = m.id AND rm.deleted = 'N'
     SET m.expires_at = ?
     WHERE rm.tb_report_id = ? AND m.deleted = 'N'`,
    [expiresAt, reportId]
  )
}

/** Freeze covers the WHOLE case (decision 141b): report + timeline +
 *  every attached media in one act. Unfreeze restamps the media clock to
 *  the report's fresh one (141d). */
export async function setAttachedMediaFrozen(
  reportId: number,
  frozen: boolean,
  expiresAt?: Date | null
): Promise<void> {
  const stampExpiry = !frozen
  await pool.query(
    `UPDATE tb_media m
     JOIN tb_report_media rm ON rm.tb_media_id = m.id AND rm.deleted = 'N'
     SET m.frozen = ?${stampExpiry ? ', m.expires_at = ?' : ''}
     WHERE rm.tb_report_id = ? AND m.deleted = 'N'`,
    stampExpiry ? [frozen ? 'S' : 'N', expiresAt ?? null, reportId] : [frozen ? 'S' : 'N', reportId]
  )
}

/** Append-only (decision 19) — there is deliberately no update/delete. */
export async function appendTimelineEvent(
  reportId: number,
  eventType: string,
  payload: Record<string, unknown> | null
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_report_timeline (tb_report_id, event_type, payload) VALUES (?, ?, ?)`,
    [reportId, eventType, payload === null ? null : JSON.stringify(payload)]
  )
}
