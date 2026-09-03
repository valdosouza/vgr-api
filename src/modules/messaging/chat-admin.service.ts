import * as repository from '@modules/messaging/chat.repository'
import {
  ChatEvidenceQuery,
  ChatParticipantRow,
  ChatReportRow,
  ChatThreadRow,
  EvidenceMessageView,
  EvidenceParticipantView,
  ReportChatEvidence,
  ThreadEvidenceView,
} from '@modules/messaging/chat.interface'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import { getRiskTier } from '@shared/risk/risk-tier'

/**
 * Panel read of a case's chat — C3 of plano-chat.md (decision 175; 116/166
 * for the audit, 23/60 for identity, 160 for the reporter's anonymity).
 * READ ONLY: nothing here writes, and the read pointer of the
 * participants (172) is never touched — the panel is not a participant.
 *
 * What this file guarantees, and the tests prove:
 *  - the panel IS the platform (60): the helper is always identifiable
 *    (accountId + displayName, whatever the offer chose and whatever the
 *    tier); the reporter only when the report is NOT anonymous (160) —
 *    for an anonymous reporter accountId/displayName are null and the
 *    internal reporter_account_id / client_key never appear (23);
 *  - text is served as stored (null after the purge, 25/131) and
 *    timestamps are EXACT (the tier degradation of 174 protects the
 *    reporter from the OTHER SIDE's correlation, 41 — not from the
 *    platform);
 *  - 404 only when the case is missing or deleted; a purged case still
 *    serves its skeleton (rows with text null), and a case with no
 *    threads serves `threads: []` — its existence is already known to a
 *    `reports` VIEW holder.
 *
 * The audit row (one per request, entity `report_chat`) is written by the
 * controller after this succeeds (implementation note on decision 116).
 * The report is read through this module's OWN repository (table access,
 * never an import of the reports module).
 */

const notFound = () => new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)

/** Decision 173, as chat.service derives it: resolved or hidden closes
 *  writes; frozen changes nothing. */
function isClosed(report: ChatReportRow): boolean {
  return report.status === 'resolved' || report.hidden
}

/** Decision 160 for the reporter: identified -> looked up once per
 *  request; anonymous -> nothing, the account is not even read. */
async function reporterIdentity(
  report: ChatReportRow
): Promise<Pick<EvidenceParticipantView, 'accountId' | 'displayName'>> {
  if (report.anonymous || report.reporterAccountId === null) {
    return { accountId: null, displayName: null }
  }
  const displayName = await repository.findAccountDisplayName(report.reporterAccountId)
  return { accountId: report.reporterAccountId, displayName }
}

function participantView(
  participant: ChatParticipantRow,
  thread: ChatThreadRow,
  report: ChatReportRow,
  reporter: Pick<EvidenceParticipantView, 'accountId' | 'displayName'>
): EvidenceParticipantView {
  if (participant.role === 'helper') {
    // Decision 60: the helper always has an account (169) and the
    // platform always knows who they are; anonymity is a choice shown
    // to the other side, not to the panel.
    return {
      role: 'helper',
      participantToken: participant.token,
      accountId: participant.accountId ?? thread.helperAccountId,
      displayName: thread.helperDisplayName,
      anonymousChoice: thread.offerAnonymous,
    }
  }
  return {
    role: 'reporter',
    participantToken: participant.token,
    accountId: reporter.accountId,
    displayName: reporter.displayName,
    anonymousChoice: report.anonymous,
  }
}

async function threadView(
  thread: ChatThreadRow,
  report: ChatReportRow,
  reporter: Pick<EvidenceParticipantView, 'accountId' | 'displayName'>,
  limit: number
): Promise<ThreadEvidenceView> {
  const participants = await repository.findParticipants(thread.id)
  if (participants.length !== 2) {
    // The masks are inserted with the thread in one transaction (C1);
    // a hole here is corruption, not a business case.
    throw new Error(`Chat thread ${thread.id} is missing a participant mask`)
  }
  const tokens = new Map(participants.map((p) => [p.id, p.token]))

  // One row past the cap tells whether the thread is longer than served.
  const rows = await repository.listMessages(thread.id, 0, limit + 1)
  const hasMore = rows.length > limit
  const messages: EvidenceMessageView[] = rows.slice(0, limit).map((row) => ({
    messageId: row.id,
    sender: tokens.get(row.senderParticipantId) ?? '',
    text: row.text,
    purged: row.purged,
    createdAt: row.createdAt.toISOString(),
  }))

  return {
    threadId: thread.id,
    helpOfferId: thread.helpOfferId,
    createdAt: thread.createdAt.toISOString(),
    closed: isClosed(report),
    participants: participants.map((p) => participantView(p, thread, report, reporter)),
    messages,
    hasMore,
  }
}

/** GET /api/reports/:id/chat — every thread of the case with its masked
 *  participants resolved for the platform, messages ascending by id. */
export async function getReportChatEvidence(
  reportId: number,
  query: ChatEvidenceQuery
): Promise<ReportChatEvidence> {
  const report = await repository.findReportForChat(reportId)
  if (!report) throw notFound()
  const tier = await getRiskTier(report.category)

  const threads = await repository.listThreadsByReport(report.id)
  if (threads.length === 0) return { reportId: report.id, tier, threads: [] }

  const reporter = await reporterIdentity(report)
  const views: ThreadEvidenceView[] = []
  for (const thread of threads) {
    views.push(await threadView(thread, report, reporter, query.limit))
  }
  return { reportId: report.id, tier, threads: views }
}
