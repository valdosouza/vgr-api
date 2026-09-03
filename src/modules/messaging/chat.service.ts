import { randomBytes } from 'crypto'
import * as repository from '@modules/messaging/chat.repository'
import {
  ChatActor,
  ChatMessageRow,
  ChatParticipantRow,
  ChatReportRow,
  ChatThreadRow,
  ChatViewer,
  MessageView,
  MessagesPage,
  MessagesQuery,
  ParticipantView,
  PostMessageInput,
  PostMessageResult,
  ThreadSummary,
} from '@modules/messaging/chat.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { findContact } from '@shared/chat/contact-filter'
import { chatConfig } from '@shared/config/env'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import { degradeTimestamp } from '@shared/geo/degrade'
import { Capabilities } from '@shared/legal/capabilities'
import { assertCapability } from '@shared/legal/legal-gate'
import { RiskTier, getRiskTier } from '@shared/risk/risk-tier'
import logger from '@shared/logger/logger'

/**
 * Masked chat (C1 of plano-chat.md — decisions 54, 169-177). The thread is
 * strictly bilateral: the report OWNER (account, or the anonymous
 * reporter presenting the report's clientKey — 134/137) and ONE helper
 * who holds an account AND an offer on that report (169). What leaves
 * the API is the mask of decision 170: an opaque token per (thread,
 * participant), a role, and a display name ONLY for an identified helper
 * outside high tier — never anything for the reporter.
 */

const RATE_WINDOW_SECONDS = 60

const notFound = () => new HttpError(404, 'Thread not found', undefined, ErrorCodes.NOT_FOUND)

/** Ownership as reports.service defines it: account match OR the bearer
 *  clientKey (decision 134 pattern). */
function owns(report: ChatReportRow, viewer: ChatViewer): boolean {
  if (viewer.accountId !== null && report.reporterAccountId === viewer.accountId) return true
  return viewer.clientKey !== null && report.clientKey === viewer.clientKey
}

/** Decision 173: resolved (18/131) or hidden (162) closes writes, reads
 *  stay; frozen (141) changes nothing. Derived at read/write time — never
 *  stamped on the chat. */
function isClosed(report: ChatReportRow): boolean {
  return report.status === 'resolved' || report.hidden
}

/** Purged (25/131) and deleted answer 404 — same posture as reports. */
async function livingReport(reportId: number): Promise<ChatReportRow> {
  const report = await repository.findReportForChat(reportId)
  if (!report || report.purged) throw notFound()
  return report
}

/** Spec MaskedIdentity: 16 random bytes as 32 hex chars, generated per
 *  (thread, participant) — never derived from anything, never reused. */
function newParticipantToken(): string {
  return randomBytes(16).toString('hex')
}

/** The mask (decisions 6/40/60/170): a helper's name only when they
 *  chose it AND the tier allows it; the reporter has no name to show. */
function participantView(
  participant: ChatParticipantRow,
  thread: ChatThreadRow,
  tier: RiskTier
): ParticipantView {
  const displayName =
    participant.role === 'helper' && !thread.offerAnonymous && tier !== 'high'
      ? thread.helperDisplayName
      : null
  return { participantToken: participant.token, role: participant.role, displayName }
}

function messageView(row: ChatMessageRow, me: ChatParticipantRow, tokens: Map<number, string>, tier: RiskTier): MessageView {
  return {
    messageId: row.id,
    clientKey: row.clientKey,
    sender: tokens.get(row.senderParticipantId) ?? '',
    mine: row.senderParticipantId === me.id,
    text: row.text,
    purged: row.purged,
    // Decision 174: temporal correlation deanonymizes (41) — bucketed by
    // tier for everyone; ordering is by id.
    createdAt: degradeTimestamp(row.createdAt, tier),
  }
}

interface Membership {
  report: ChatReportRow
  thread: ChatThreadRow
  me: ChatParticipantRow
  other: ChatParticipantRow
  tier: RiskTier
}

/**
 * Who the viewer is on this thread, derived from the REPORT row (single
 * source of truth for ownership) and the thread's helper account —
 * anyone else, another helper of the same case included, gets the same
 * 404 a missing thread gets (55: existence is information).
 */
async function membership(thread: ChatThreadRow, viewer: ChatViewer): Promise<Membership> {
  const report = await livingReport(thread.reportId)
  const participants = await repository.findParticipants(thread.id)
  const reporter = participants.find((p) => p.role === 'reporter')
  const helper = participants.find((p) => p.role === 'helper')
  if (!reporter || !helper) throw notFound()

  let me: ChatParticipantRow
  let other: ChatParticipantRow
  if (owns(report, viewer)) {
    me = reporter
    other = helper
  } else if (viewer.accountId !== null && viewer.accountId === thread.helperAccountId) {
    me = helper
    other = reporter
  } else {
    throw notFound()
  }
  const tier = await getRiskTier(report.category)
  return { report, thread, me, other, tier }
}

async function summarize(m: Membership): Promise<ThreadSummary> {
  return {
    threadId: m.thread.id,
    reportId: m.thread.reportId,
    me: participantView(m.me, m.thread, m.tier),
    other: participantView(m.other, m.thread, m.tier),
    lastMessageAt: m.thread.lastMessageAt
      ? degradeTimestamp(m.thread.lastMessageAt, m.tier)
      : null,
    unreadCount: await repository.countUnread(m.thread.id, m.me.id, m.me.lastReadMessageId),
    closed: isClosed(m.report),
  }
}

/**
 * GET /app-chat/:reportId/threads — the owner sees every thread of the
 * case (one per helper, 55); a helper with an identified offer sees their
 * own thread or an empty list; anyone else 404.
 */
export async function listThreads(
  reportId: number,
  viewer: ChatViewer
): Promise<{ threads: ThreadSummary[] }> {
  const report = await livingReport(reportId)

  let threads: ChatThreadRow[]
  if (owns(report, viewer)) {
    threads = await repository.listThreadsByReport(report.id)
  } else if (viewer.accountId !== null) {
    const offer = await repository.findOfferByAccount(report.id, viewer.accountId)
    if (!offer) throw notFound()
    const own = await repository.findThreadByReportAndHelper(report.id, viewer.accountId)
    threads = own ? [own] : []
  } else {
    throw notFound()
  }

  const summaries: ThreadSummary[] = []
  for (const thread of threads) {
    summaries.push(await summarize(await membership(thread, viewer)))
  }
  return { threads: summaries }
}

/** Text rules (171/177): trim, 1..CHAT_MAX_LENGTH, no direct contact.
 *  Both refusals are 422 with the field contract of decision 83. */
function validateText(raw: string): string {
  const text = raw.trim()
  if (text.length === 0) {
    throw new HttpError(
      422,
      'Validation failed',
      [{ field: 'text', message: 'Text is required', code: FieldErrorCodes.REQUIRED }],
      ErrorCodes.VALIDATION_FAILED
    )
  }
  const { maxLength } = chatConfig()
  if (text.length > maxLength) {
    throw new HttpError(
      422,
      'Validation failed',
      [
        {
          field: 'text',
          message: `Text must be at most ${maxLength} characters`,
          code: FieldErrorCodes.TOO_LONG,
          params: { max: String(maxLength) },
        },
      ],
      ErrorCodes.VALIDATION_FAILED
    )
  }
  const contact = findContact(text)
  if (contact) {
    throw new HttpError(
      422,
      'Direct contact is not allowed in the chat',
      [
        {
          field: 'text',
          message: 'Direct contact is not allowed in the chat',
          code: FieldErrorCodes.CONTACT_NOT_ALLOWED,
          params: { kind: contact.kind, match: contact.match },
        },
      ],
      ErrorCodes.CONTACT_NOT_ALLOWED
    )
  }
  return text
}

/**
 * The post itself, shared by both routes. Ordering encodes the product's
 * principles, as in submitReport:
 *  1. idempotency first (172/137): a replay answers the same message even
 *     if the case closed since — a flaky network is never punished;
 *  2. closed case (173) -> 409;
 *  3. text rules (171/177) -> 422;
 *  4. Legal Gate before any write (176) -> 451;
 *  5. rate window counted in the DB (177) -> 429;
 *  6. append + accountability for the anonymous reporter (23/123).
 */
async function post(m: Membership, input: PostMessageInput, actor: ChatActor): Promise<PostMessageResult> {
  const tokens = new Map([
    [m.me.id, m.me.token],
    [m.other.id, m.other.token],
  ])
  const replay = (row: ChatMessageRow): PostMessageResult => ({
    threadId: m.thread.id,
    message: messageView(row, m.me, tokens, m.tier),
    replayed: true,
  })

  const existing = await repository.findMessageByClientKey(m.thread.id, input.clientKey)
  if (existing) return replay(existing)

  if (isClosed(m.report)) {
    throw new HttpError(409, 'The chat is closed for this report', undefined, ErrorCodes.CHAT_CLOSED)
  }

  const text = validateText(input.text)

  await assertCapability(Capabilities.CHAT_MASKED, {
    userRef: actor.accountId === null ? undefined : String(actor.accountId),
    ip: actor.ip,
  })

  const { ratePerMinute } = chatConfig()
  const recent = await repository.countRecentMessages(m.me.id, RATE_WINDOW_SECONDS)
  if (recent >= ratePerMinute) {
    throw new HttpError(429, 'Too many messages, slow down', undefined, ErrorCodes.RATE_LIMITED, {
      limit: String(ratePerMinute),
      windowSeconds: String(RATE_WINDOW_SECONDS),
    })
  }

  let row = await repository.insertMessage({
    threadId: m.thread.id,
    senderParticipantId: m.me.id,
    clientKey: input.clientKey,
    text,
  })
  if (!row) {
    // Two replays racing on the unique clientKey — the winner's row is
    // the answer for both (137).
    const winner = await repository.findMessageByClientKey(m.thread.id, input.clientKey)
    if (!winner) throw new Error('Chat message vanished after a duplicate-key race')
    return replay(winner)
  }

  if (m.me.role === 'reporter' && actor.accountId === null) {
    try {
      // Decision 23: the anonymous reporter's post leaves the forensic
      // trail — and, like submit, never blocks the flow (123).
      await appendAccountabilityLogEntry('chat.message', actor.ip, {
        threadId: m.thread.id,
        messageId: row.id,
      })
    } catch (err) {
      logger.error('Accountability write failed for chat.message', { err, threadId: m.thread.id })
    }
  }

  return { threadId: m.thread.id, message: messageView(row, m.me, tokens, m.tier), replayed: false }
}

/**
 * POST /app-chat/:reportId/messages — the HELPER's entry point: the
 * thread is find-or-create on their FIRST message (173). The owner has no
 * business here (20 — no thread with themself): 403, they post into an
 * existing thread. A helper without an account or without an offer gets
 * 404 (169).
 */
export async function postToReport(
  reportId: number,
  input: PostMessageInput,
  actor: ChatActor
): Promise<PostMessageResult> {
  const report = await livingReport(reportId)
  if (owns(report, actor)) {
    throw new HttpError(
      403,
      'The reporter posts through the thread route',
      undefined,
      ErrorCodes.FORBIDDEN
    )
  }
  if (actor.accountId === null) throw notFound()
  const offer = await repository.findOfferByAccount(report.id, actor.accountId)
  if (!offer) throw notFound()

  let thread = await repository.findThreadByReportAndHelper(report.id, actor.accountId)
  if (!thread) {
    // No thread yet: a replay is impossible, so the closed check and the
    // gate come BEFORE the thread is created (173/176).
    if (isClosed(report)) {
      throw new HttpError(409, 'The chat is closed for this report', undefined, ErrorCodes.CHAT_CLOSED)
    }
    validateText(input.text)
    await assertCapability(Capabilities.CHAT_MASKED, {
      userRef: String(actor.accountId),
      ip: actor.ip,
    })
    const created = await repository.insertThreadWithParticipants({
      reportId: report.id,
      helperAccountId: actor.accountId,
      helpOfferId: offer.id,
      reporter: {
        accountId: report.reporterAccountId,
        clientKey: report.clientKey,
        token: newParticipantToken(),
      },
      helper: { accountId: actor.accountId, token: newParticipantToken() },
    })
    // null = the UNIQUE (report, helper) key collided: another first
    // message won the race; its thread is ours too.
    thread = created === null
      ? await repository.findThreadByReportAndHelper(report.id, actor.accountId)
      : await repository.findThreadById(created)
    if (!thread) throw new Error('Chat thread vanished after creation')
  }

  return post(await membership(thread, actor), input, actor)
}

/** POST /app-chat/threads/:threadId/messages — participants only. */
export async function postToThread(
  threadId: number,
  input: PostMessageInput,
  actor: ChatActor
): Promise<PostMessageResult> {
  const thread = await repository.findThreadById(threadId)
  if (!thread) throw notFound()
  return post(await membership(thread, actor), input, actor)
}

/**
 * GET /app-chat/threads/:threadId/messages?after&limit — participants
 * only. Serves the page ascending by id and advances the caller's OWN
 * read pointer to the max served id (172) — a pointer, not a receipt: the
 * other side never sees it (174). Reads are not gated and never close.
 */
export async function getMessages(
  threadId: number,
  query: MessagesQuery,
  viewer: ChatViewer
): Promise<MessagesPage> {
  const thread = await repository.findThreadById(threadId)
  if (!thread) throw notFound()
  const m = await membership(thread, viewer)

  const tokens = new Map([
    [m.me.id, m.me.token],
    [m.other.id, m.other.token],
  ])
  const rows = await repository.listMessages(m.thread.id, query.after, query.limit)
  if (rows.length > 0) {
    await repository.advanceLastRead(m.me.id, rows[rows.length - 1].id)
  }

  return {
    threadId: m.thread.id,
    closed: isClosed(m.report),
    tier: m.tier,
    messages: rows.map((row) => messageView(row, m.me, tokens, m.tier)),
  }
}
