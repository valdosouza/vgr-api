import pool from '@shared/db/connection'
import { Category, ReportRow, ReportStatus, Subject } from '@modules/reports/reports.interface'

const REPORT_SELECT = `
  SELECT id, client_key AS clientKey, category, free_tag AS freeTag, subject,
         detail_fields AS detailFields, lat, lng, anonymous,
         reporter_account_id AS reporterAccountId, status,
         resolved_at AS resolvedAt, expires_at AS expiresAt, frozen,
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
    lat: Number(row.lat),
    lng: Number(row.lng),
    anonymous: row.anonymous === 'S',
    reporterAccountId: row.reporterAccountId ?? null,
    status: row.status as ReportStatus,
    resolvedAt: row.resolvedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    frozen: row.frozen === 'S',
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
