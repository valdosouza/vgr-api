import pool from '@shared/db/connection'
import {
  ChatMessageRow,
  ChatOfferRow,
  ChatParticipantRow,
  ChatReportRow,
  ChatRole,
  ChatThreadRow,
} from '@modules/messaging/chat.interface'

/**
 * Persistence of the Messaging context (migration 043). SQL over
 * tb_report / tb_help_offer / tb_user_account is table access, not a
 * module import (same posture as help-offers reading tb_report).
 *
 * The panel reader of C3 (decision 175) is NOT built here, but
 * listThreadsByReport + listMessages already give it everything it needs
 * by report id.
 */

/** The guard columns of the case the chat hangs on (deleted rows are gone;
 *  purged ones are returned so the service answers the same 404 as reports). */
export async function findReportForChat(reportId: number): Promise<ChatReportRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, client_key AS clientKey, reporter_account_id AS reporterAccountId,
            anonymous, category, status, hidden, frozen, purged
     FROM tb_report WHERE id = ? AND deleted = 'N'`,
    [reportId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    clientKey: row.clientKey,
    reporterAccountId: row.reporterAccountId ?? null,
    anonymous: row.anonymous === 'S',
    category: row.category ?? null,
    status: row.status,
    hidden: row.hidden === 'S',
    frozen: row.frozen === 'S',
    purged: row.purged === 'S',
  }
}

/** The C3 panel read (decision 175) names an IDENTIFIED reporter (160):
 *  one account's display name, by id. Table access on tb_user_account —
 *  never an import of the accounts or reports module. */
export async function findAccountDisplayName(accountId: number): Promise<string | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT display_name AS displayName FROM tb_user_account WHERE id = ?`,
    [accountId]
  )
  return rows[0]?.displayName ?? null
}

/** ONLY identified offers match (helper_account_id = ?) — a helper who
 *  offered without an account has no routable identity (decision 169). */
export async function findOfferByAccount(
  reportId: number,
  accountId: number
): Promise<ChatOfferRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT o.id, o.helper_account_id AS helperAccountId, o.anonymous,
            a.display_name AS helperDisplayName
     FROM tb_help_offer o
     LEFT JOIN tb_user_account a ON a.id = o.helper_account_id
     WHERE o.tb_report_id = ? AND o.helper_account_id = ? AND o.deleted = 'N'
     LIMIT 1`,
    [reportId, accountId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    helperAccountId: row.helperAccountId,
    anonymous: row.anonymous === 'S',
    helperDisplayName: row.helperDisplayName ?? null,
  }
}

const THREAD_SELECT = `
  SELECT t.id, t.tb_report_id AS reportId, t.helper_account_id AS helperAccountId,
         t.help_offer_id AS helpOfferId, t.created_at AS createdAt,
         o.anonymous AS offerAnonymous, a.display_name AS helperDisplayName,
         (SELECT MAX(m.created_at) FROM tb_chat_message m
          WHERE m.tb_chat_thread_id = t.id) AS lastMessageAt
  FROM tb_chat_thread t
  JOIN tb_help_offer o ON o.id = t.help_offer_id
  LEFT JOIN tb_user_account a ON a.id = t.helper_account_id`

function toThread(row: any): ChatThreadRow {
  return {
    id: row.id,
    reportId: row.reportId,
    helperAccountId: row.helperAccountId,
    helpOfferId: row.helpOfferId,
    createdAt: row.createdAt,
    offerAnonymous: row.offerAnonymous === 'S',
    helperDisplayName: row.helperDisplayName ?? null,
    lastMessageAt: row.lastMessageAt ?? null,
  }
}

export async function findThreadById(threadId: number): Promise<ChatThreadRow | null> {
  const [rows] = await pool.query<any[]>(`${THREAD_SELECT} WHERE t.id = ? AND t.deleted = 'N'`, [
    threadId,
  ])
  return rows[0] ? toThread(rows[0]) : null
}

export async function findThreadByReportAndHelper(
  reportId: number,
  helperAccountId: number
): Promise<ChatThreadRow | null> {
  const [rows] = await pool.query<any[]>(
    `${THREAD_SELECT} WHERE t.tb_report_id = ? AND t.helper_account_id = ? AND t.deleted = 'N'`,
    [reportId, helperAccountId]
  )
  return rows[0] ? toThread(rows[0]) : null
}

/** The owner's list (and the C3 panel reader's entry point). */
export async function listThreadsByReport(reportId: number): Promise<ChatThreadRow[]> {
  const [rows] = await pool.query<any[]>(
    `${THREAD_SELECT} WHERE t.tb_report_id = ? AND t.deleted = 'N' ORDER BY t.id`,
    [reportId]
  )
  return rows.map(toThread)
}

/**
 * Find-or-create's CREATE half (decision 173), atomic: thread + both
 * participant masks commit together — a thread without its masks would be
 * unreadable. Returns null when the UNIQUE (report, helper) key collides:
 * two first messages raced and the caller re-reads the winner.
 */
export async function insertThreadWithParticipants(input: {
  reportId: number
  helperAccountId: number
  helpOfferId: number
  reporter: { accountId: number | null; clientKey: string; token: string }
  helper: { accountId: number; token: string }
}): Promise<number | null> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    let threadId: number
    try {
      const [result] = await conn.query<any>(
        `INSERT INTO tb_chat_thread (tb_report_id, helper_account_id, help_offer_id)
         VALUES (?, ?, ?)`,
        [input.reportId, input.helperAccountId, input.helpOfferId]
      )
      threadId = result.insertId
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        await conn.rollback()
        return null
      }
      throw err
    }
    await conn.query(
      `INSERT INTO tb_chat_participant (tb_chat_thread_id, role, account_id, client_key, token)
       VALUES (?, 'reporter', ?, ?, ?), (?, 'helper', ?, NULL, ?)`,
      [
        threadId,
        input.reporter.accountId,
        input.reporter.clientKey,
        input.reporter.token,
        threadId,
        input.helper.accountId,
        input.helper.token,
      ]
    )
    await conn.commit()
    return threadId
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

function toParticipant(row: any): ChatParticipantRow {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as ChatRole,
    accountId: row.accountId ?? null,
    clientKey: row.clientKey ?? null,
    token: row.token,
    lastReadMessageId: row.lastReadMessageId == null ? null : Number(row.lastReadMessageId),
  }
}

export async function findParticipants(threadId: number): Promise<ChatParticipantRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, tb_chat_thread_id AS threadId, role, account_id AS accountId,
            client_key AS clientKey, token, last_read_message_id AS lastReadMessageId
     FROM tb_chat_participant WHERE tb_chat_thread_id = ? ORDER BY id`,
    [threadId]
  )
  return rows.map(toParticipant)
}

const MESSAGE_SELECT = `
  SELECT id, tb_chat_thread_id AS threadId, sender_participant_id AS senderParticipantId,
         client_key AS clientKey, text, purged, created_at AS createdAt
  FROM tb_chat_message`

function toMessage(row: any): ChatMessageRow {
  return {
    id: Number(row.id),
    threadId: row.threadId,
    senderParticipantId: row.senderParticipantId,
    clientKey: row.clientKey,
    text: row.text ?? null,
    purged: row.purged === 'S',
    createdAt: row.createdAt,
  }
}

export async function findMessageByClientKey(
  threadId: number,
  clientKey: string
): Promise<ChatMessageRow | null> {
  const [rows] = await pool.query<any[]>(
    `${MESSAGE_SELECT} WHERE tb_chat_thread_id = ? AND client_key = ?`,
    [threadId, clientKey]
  )
  return rows[0] ? toMessage(rows[0]) : null
}

/** Append (decision 177: no update, no delete exists). Returns the stored
 *  row, or null when the UNIQUE (thread, clientKey) collided — an offline
 *  queue replay racing itself (172/137); the caller re-reads the winner. */
export async function insertMessage(input: {
  threadId: number
  senderParticipantId: number
  clientKey: string
  text: string
}): Promise<ChatMessageRow | null> {
  let insertId: number
  try {
    const [result] = await pool.query<any>(
      `INSERT INTO tb_chat_message (tb_chat_thread_id, sender_participant_id, client_key, text)
       VALUES (?, ?, ?, ?)`,
      [input.threadId, input.senderParticipantId, input.clientKey, input.text]
    )
    insertId = result.insertId
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') return null
    throw err
  }
  const [rows] = await pool.query<any[]>(`${MESSAGE_SELECT} WHERE id = ?`, [insertId])
  return rows[0] ? toMessage(rows[0]) : null
}

/** Cursor page (decision 172): id > after, ascending by id. */
export async function listMessages(
  threadId: number,
  after: number,
  limit: number
): Promise<ChatMessageRow[]> {
  const [rows] = await pool.query<any[]>(
    `${MESSAGE_SELECT} WHERE tb_chat_thread_id = ? AND id > ? ORDER BY id LIMIT ?`,
    [threadId, after, limit]
  )
  return rows.map(toMessage)
}

/** Sliding window of decision 177, counted in the DATABASE clock — no
 *  in-memory state, so every instance enforces the same number. */
export async function countRecentMessages(
  participantId: number,
  windowSeconds: number
): Promise<number> {
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_chat_message
     WHERE sender_participant_id = ? AND created_at > NOW() - INTERVAL ? SECOND`,
    [participantId, windowSeconds]
  )
  return Number(rows[0]?.total ?? 0)
}

/** Messages from the OTHER side past the caller's own pointer (172). */
export async function countUnread(
  threadId: number,
  participantId: number,
  lastReadMessageId: number | null
): Promise<number> {
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_chat_message
     WHERE tb_chat_thread_id = ? AND sender_participant_id <> ? AND id > ?`,
    [threadId, participantId, lastReadMessageId ?? 0]
  )
  return Number(rows[0]?.total ?? 0)
}

/** Only ever moves forward — a stale page never rewinds the pointer. */
export async function advanceLastRead(participantId: number, messageId: number): Promise<void> {
  await pool.query(
    `UPDATE tb_chat_participant SET last_read_message_id = ?
     WHERE id = ? AND (last_read_message_id IS NULL OR last_read_message_id < ?)`,
    [messageId, participantId, messageId]
  )
}
