import pool from '@shared/db/connection'
import {
  Category,
  QueueTierSets,
  ReportRow,
  ReportSearchFilters,
  ReportSearchRow,
  ReportStatus,
  Subject,
} from '@modules/reports/reports.interface'
import { ModerationReason } from '@shared/moderation/moderation-reason'
import { RiskTier } from '@shared/risk/risk-tier'

const REPORT_SELECT = `
  SELECT id, client_key AS clientKey, category, free_tag AS freeTag, subject,
         detail_fields AS detailFields, lat, lng, anonymous,
         reporter_account_id AS reporterAccountId, status,
         resolved_at AS resolvedAt, expires_at AS expiresAt, frozen,
         frozen_reason AS frozenReason, frozen_at AS frozenAt, purged,
         hidden, hidden_reason_code AS hiddenReasonCode, hidden_note AS hiddenNote,
         hidden_at AS hiddenAt, hidden_by AS hiddenBy,
         reviewed_at AS reviewedAt, reviewed_by AS reviewedBy,
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
    hidden: row.hidden === 'S',
    hiddenReasonCode: row.hiddenReasonCode ?? null,
    hiddenNote: row.hiddenNote ?? null,
    hiddenAt: row.hiddenAt ?? null,
    hiddenBy: row.hiddenBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
    reviewedBy: row.reviewedBy ?? null,
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

/**
 * Hide (B2, decision 162): atomic hidden N -> S — 0 rows = already
 * hidden (or gone). ONLY the five hidden_* columns move: retention
 * (expires_at), freeze and status are not moderation's, and no timeline
 * event is written (167).
 */
export async function hideReport(
  id: number,
  reasonCode: ModerationReason,
  note: string | null,
  actorId: number
): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_report
     SET hidden = 'S', hidden_reason_code = ?, hidden_note = ?, hidden_at = NOW(), hidden_by = ?
     WHERE id = ? AND hidden = 'N' AND deleted = 'N'`,
    [reasonCode, note, actorId, id]
  )
  return result.affectedRows > 0
}

/** Unhide (162): atomic S -> N, clearing the five columns — the reason for
 *  reverting lives in tb_admin_audit, not on the row. */
export async function unhideReport(id: number): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_report
     SET hidden = 'N', hidden_reason_code = NULL, hidden_note = NULL, hidden_at = NULL, hidden_by = NULL
     WHERE id = ? AND hidden = 'S' AND deleted = 'N'`,
    [id]
  )
  return result.affectedRows > 0
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
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `UPDATE tb_report
       SET detail_fields = NULL, lat = NULL, lng = NULL,
           free_tag = IF(free_tag IS NULL, NULL, '[purged]'), purged = 'S'
       WHERE id = ?`,
      [id]
    )
    await conn.query(`UPDATE tb_report_timeline SET payload = NULL WHERE tb_report_id = ?`, [id])
    // The chat follows the case's retention (decision 173): text nulled,
    // rows / counts / timestamps kept — same skeleton rule as the report.
    // SQL over tb_chat_message is table access, not a module import.
    await conn.query(
      `UPDATE tb_chat_message m
       JOIN tb_chat_thread t ON t.id = m.tb_chat_thread_id
       SET m.text = NULL, m.purged = 'S'
       WHERE t.tb_report_id = ?`,
      [id]
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/* ------------------------------------------------------------------ *
 * Chat entry point on the detail view (C1 — decision 172). Counts only:
 * the messages themselves are the messaging module's.
 * ------------------------------------------------------------------ */

/** Owner side: how many threads the case has, and how many messages from
 *  helpers sit past the REPORTER's own read pointer across all of them. */
export async function getOwnerChatSummary(
  reportId: number
): Promise<{ threads: number; unread: number }> {
  const [threadRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_chat_thread WHERE tb_report_id = ? AND deleted = 'N'`,
    [reportId]
  )
  const [unreadRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM tb_chat_message m
     JOIN tb_chat_thread t ON t.id = m.tb_chat_thread_id AND t.deleted = 'N'
     JOIN tb_chat_participant p ON p.tb_chat_thread_id = t.id AND p.role = 'reporter'
     WHERE t.tb_report_id = ? AND m.sender_participant_id <> p.id
       AND (p.last_read_message_id IS NULL OR m.id > p.last_read_message_id)`,
    [reportId]
  )
  return {
    threads: Number(threadRows[0]?.total ?? 0),
    unread: Number(unreadRows[0]?.total ?? 0),
  }
}

/** Helper side: their own thread on the case (null before the first
 *  message, 173) and the reporter's messages past THEIR read pointer. */
export async function getHelperChatSummary(
  reportId: number,
  helperAccountId: number
): Promise<{ threadId: number; unread: number } | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT t.id AS threadId,
            (SELECT COUNT(*) FROM tb_chat_message m
             WHERE m.tb_chat_thread_id = t.id AND m.sender_participant_id <> p.id
               AND (p.last_read_message_id IS NULL OR m.id > p.last_read_message_id)) AS unread
     FROM tb_chat_thread t
     JOIN tb_chat_participant p ON p.tb_chat_thread_id = t.id AND p.role = 'helper'
     WHERE t.tb_report_id = ? AND t.helper_account_id = ? AND t.deleted = 'N'`,
    [reportId, helperAccountId]
  )
  const row = rows[0]
  return row ? { threadId: row.threadId, unread: Number(row.unread ?? 0) } : null
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

/* ------------------------------------------------------------------ *
 * Panel plane — B1 of plano-moderacao-painel.md (decisions 159/160/166).
 * ------------------------------------------------------------------ */

/**
 * Paginated search for the panel list. Excludes soft-deleted rows, KEEPS
 * purged ones (the statistical skeleton survives purge, 25/131). The
 * projection deliberately omits client_key and reporter_account_id: the
 * list never needs identity, so it never loads it (160). Sort is fixed:
 * newest first, id as tiebreaker.
 */
export async function searchReports(
  filters: ReportSearchFilters,
  page: number,
  pageSize: number
): Promise<{ rows: ReportSearchRow[]; total: number }> {
  const where: string[] = [`r.deleted = 'N'`]
  const params: unknown[] = []

  if (filters.id !== undefined) {
    where.push('r.id = ?')
    params.push(filters.id)
  }
  if (filters.status !== undefined) {
    where.push('r.status = ?')
    params.push(filters.status)
  }
  if (filters.category !== undefined) {
    where.push('r.category = ?')
    params.push(filters.category)
  }
  if (filters.subject !== undefined) {
    where.push('r.subject = ?')
    params.push(filters.subject)
  }
  if (filters.categories !== undefined) {
    // Tier filter (159): the set resolved by the service. An empty set
    // with no free-tag match can match nothing — expressed as 1=0.
    const clauses: string[] = []
    if (filters.categories.length > 0) {
      clauses.push(`r.category IN (${filters.categories.map(() => '?').join(', ')})`)
      params.push(...filters.categories)
    }
    if (filters.includeFreeTag) clauses.push('r.category IS NULL')
    where.push(clauses.length > 0 ? `(${clauses.join(' OR ')})` : '1 = 0')
  }
  if (filters.frozen !== undefined) {
    where.push('r.frozen = ?')
    params.push(filters.frozen ? 'S' : 'N')
  }
  if (filters.hidden !== undefined) {
    where.push('r.hidden = ?')
    params.push(filters.hidden ? 'S' : 'N')
  }
  if (filters.reviewed !== undefined) {
    // Review mark (B3, 161) is the timestamp itself — no flag column.
    where.push(filters.reviewed ? 'r.reviewed_at IS NOT NULL' : 'r.reviewed_at IS NULL')
  }
  if (filters.hasMedia !== undefined) {
    where.push(
      `${filters.hasMedia ? '' : 'NOT '}EXISTS (
         SELECT 1 FROM tb_report_media rm
         JOIN tb_media m ON m.id = rm.tb_media_id AND m.deleted = 'N'
         WHERE rm.tb_report_id = r.id AND rm.deleted = 'N')`
    )
  }
  if (filters.createdFrom !== undefined) {
    where.push('r.created_at >= ?')
    params.push(filters.createdFrom)
  }
  if (filters.createdTo !== undefined) {
    where.push(filters.createdToExclusive ? 'r.created_at < ?' : 'r.created_at <= ?')
    params.push(filters.createdTo)
  }

  const whereSql = where.join(' AND ')
  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_report r WHERE ${whereSql}`,
    params
  )
  const total = Number(countRows[0]?.total ?? 0)
  if (total === 0) return { rows: [], total }

  const [rows] = await pool.query<any[]>(
    `${PANEL_LIST_SELECT}
     WHERE ${whereSql}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  )
  return { rows: rows.map(toSearchRow), total }
}

/** Living attached media, any status — B1's hasMedia definition. */
const LIVING_MEDIA_EXISTS = `EXISTS (
         SELECT 1 FROM tb_report_media rm
         JOIN tb_media m ON m.id = rm.tb_media_id AND m.deleted = 'N'
         WHERE rm.tb_report_id = r.id AND rm.deleted = 'N')`

/** The list projection shared by the search and the queue: NO client_key,
 *  NO reporter_account_id (160). */
const PANEL_LIST_SELECT = `
  SELECT r.id, r.category, r.free_tag AS freeTag, r.subject, r.anonymous, r.status,
         r.frozen, r.purged, r.hidden, r.reviewed_at AS reviewedAt, r.lat, r.lng,
         r.created_at AS createdAt, r.resolved_at AS resolvedAt,
         (SELECT COUNT(*) FROM tb_report_media rm
          JOIN tb_media m ON m.id = rm.tb_media_id AND m.deleted = 'N'
          WHERE rm.tb_report_id = r.id AND rm.deleted = 'N') AS mediaCount
  FROM tb_report r`

function toSearchRow(row: any): ReportSearchRow {
  return {
    id: row.id,
    category: (row.category as Category) ?? null,
    freeTag: row.freeTag ?? null,
    subject: row.subject as Subject,
    anonymous: row.anonymous === 'S',
    status: row.status as ReportStatus,
    frozen: row.frozen === 'S',
    purged: row.purged === 'S',
    hidden: row.hidden === 'S',
    reviewed: row.reviewedAt != null,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    mediaCount: Number(row.mediaCount ?? 0),
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }
}

/* ------------------------------------------------------------------ *
 * Proactive moderation queue — B3 of plano-moderacao-painel.md
 * (decision 161).
 * ------------------------------------------------------------------ */

const TIER_RANK: Record<RiskTier, number> = { high: 0, medium: 1, low: 2 }

/**
 * The queue: open, NOT reviewed, NOT hidden (a hidden case was already
 * moderated), NOT purged, living. Frozen cases STAY in (161). Ordered by
 * tier (a CASE over the category sets the service resolved from
 * shared/risk — free-tag rows rank by their own tier), then cases WITH
 * media first, then oldest first with id as the tiebreaker. Same
 * projection as the search: no identity (160).
 */
export async function queueReports(
  tiers: QueueTierSets,
  page: number,
  pageSize: number
): Promise<{ rows: ReportSearchRow[]; total: number }> {
  const whereSql = `r.deleted = 'N' AND r.status = 'open' AND r.reviewed_at IS NULL
       AND r.hidden = 'N' AND r.purged = 'N'`

  const [countRows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_report r WHERE ${whereSql}`
  )
  const total = Number(countRows[0]?.total ?? 0)
  if (total === 0) return { rows: [], total }

  // Decision 161: when the user "flag content" signal exists, it enters
  // THIS queue ABOVE the tier priority — it becomes the first ORDER BY key,
  // before the CASE below. Not built here (no such signal yet).
  const whens: string[] = ['WHEN r.category IS NULL THEN ?']
  const params: unknown[] = [TIER_RANK[tiers.freeTagTier]]
  for (const tier of ['high', 'medium', 'low'] as RiskTier[]) {
    const categories = tiers.tierCategories[tier]
    if (categories.length === 0) continue
    whens.push(`WHEN r.category IN (${categories.map(() => '?').join(', ')}) THEN ${TIER_RANK[tier]}`)
    params.push(...categories)
  }

  const [rows] = await pool.query<any[]>(
    `${PANEL_LIST_SELECT}
     WHERE ${whereSql}
     ORDER BY CASE ${whens.join(' ')} ELSE ${TIER_RANK.low} END ASC,
              ${LIVING_MEDIA_EXISTS} DESC,
              r.created_at ASC, r.id ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  )
  return { rows: rows.map(toSearchRow), total }
}

/**
 * Mark reviewed (161/165): atomic reviewed_at IS NULL -> NOW() — 0 rows =
 * already reviewed (or gone). ONLY the two reviewed_* columns move: it is
 * not a moderation act (hidden), not a lifecycle act (status/frozen),
 * not retention (expires_at), and no timeline event is written.
 */
export async function markReviewed(id: number, actorId: number): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_report SET reviewed_at = NOW(), reviewed_by = ?
     WHERE id = ? AND reviewed_at IS NULL AND deleted = 'N'`,
    [actorId, id]
  )
  return result.affectedRows > 0
}

/** Attached media for the PANEL detail: every living tb_media row with
 *  its status — blocked/pending included (M3: the panel keeps reading
 *  what the app plane no longer serves). */
export async function findAttachedMediaWithStatus(reportId: number): Promise<
  Array<{
    publicId: string
    mime: string
    width: number
    height: number
    status: string
    blockedReasonCode: ModerationReason | null
    blockedNote: string | null
    blockedAt: Date | null
  }>
> {
  const [rows] = await pool.query<any[]>(
    `SELECT m.public_id AS publicId, m.mime, m.width, m.height, m.status,
            m.blocked_reason_code AS blockedReasonCode, m.blocked_note AS blockedNote,
            m.blocked_at AS blockedAt
     FROM tb_media m
     JOIN tb_report_media rm ON rm.tb_media_id = m.id AND rm.deleted = 'N'
     WHERE rm.tb_report_id = ? AND m.deleted = 'N'
     ORDER BY rm.id`,
    [reportId]
  )
  return rows.map((row) => ({
    publicId: row.publicId,
    mime: row.mime,
    width: row.width,
    height: row.height,
    status: row.status,
    blockedReasonCode: row.blockedReasonCode ?? null,
    blockedNote: row.blockedNote ?? null,
    blockedAt: row.blockedAt ?? null,
  }))
}

/** Display name only — never the e-mail (decision 160). */
export async function findAccountDisplayName(accountId: number): Promise<string | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT display_name AS displayName FROM tb_user_account WHERE id = ?`,
    [accountId]
  )
  return rows[0]?.displayName ?? null
}

/** Offers for the PANEL detail, with the helper's opaque id + display
 *  name (masking of anonymous helpers happens in the service, 160). */
export async function findOffersForPanel(
  reportId: number
): Promise<
  Array<{
    id: number
    helpType: string
    anonymous: boolean
    helperAccountId: number | null
    helperDisplayName: string | null
    createdAt: Date
  }>
> {
  const [rows] = await pool.query<any[]>(
    `SELECT o.id, o.help_type AS helpType, o.anonymous,
            o.helper_account_id AS helperAccountId,
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
    helperAccountId: row.helperAccountId ?? null,
    helperDisplayName: row.helperDisplayName ?? null,
    createdAt: row.createdAt,
  }))
}
