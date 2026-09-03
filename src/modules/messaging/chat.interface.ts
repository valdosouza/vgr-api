import type { RiskTier } from '@shared/risk/risk-tier'

/**
 * Masked chat — the Messaging bounded context (spec task 29 as amended;
 * decisions 54, 168-177). One thread per (report, helper ACCOUNT); every
 * participant leaves the API as an opaque token (spec MaskedIdentity).
 */

export type ChatRole = 'reporter' | 'helper'

/** The slice of tb_report the chat needs — read by SQL in this module's
 *  repository (table access, not a module import). */
export interface ChatReportRow {
  id: number
  /** The report's idempotency key = the anonymous reporter's bearer
   *  secret (134/137). Internal only — never serialized. */
  clientKey: string
  reporterAccountId: number | null
  category: string | null
  status: 'open' | 'resolved'
  hidden: boolean
  frozen: boolean
  purged: boolean
}

/** An IDENTIFIED help offer (helper_account_id NOT NULL) — the only kind
 *  that can open a thread (decision 169). */
export interface ChatOfferRow {
  id: number
  helperAccountId: number
  anonymous: boolean
  helperDisplayName: string | null
}

export interface ChatThreadRow {
  id: number
  reportId: number
  helperAccountId: number
  helpOfferId: number
  createdAt: Date
  /** Joined from the offer and the account so the service can mask
   *  (decisions 6/40/60/170); never serialized as-is. */
  offerAnonymous: boolean
  helperDisplayName: string | null
  lastMessageAt: Date | null
}

export interface ChatParticipantRow {
  id: number
  threadId: number
  role: ChatRole
  accountId: number | null
  clientKey: string | null
  /** The mask (decision 170): 32 hex chars, unique per (thread, participant). */
  token: string
  /** The reader's OWN pointer (172) — never a receipt (174). */
  lastReadMessageId: number | null
}

export interface ChatMessageRow {
  id: number
  threadId: number
  senderParticipantId: number
  /** App-generated idempotency key of THIS message (172). */
  clientKey: string
  /** Null after purge (25/131). */
  text: string | null
  purged: boolean
  createdAt: Date
}

/** Who is looking — same shape as reports' ViewerContext: the session
 *  account and/or the report's clientKey from the x-client-key header. */
export interface ChatViewer {
  accountId: number | null
  clientKey: string | null
}

export interface ChatActor extends ChatViewer {
  ip: string
}

export interface PostMessageInput {
  clientKey: string
  text: string
}

export interface MessagesQuery {
  /** Cursor: only messages with id > after (172). */
  after: number
  limit: number
}

/* ------------------------------------------------------------------ *
 * What leaves the API (decision 170): tokens and roles, a display name
 * ONLY for an identified helper outside high tier, never for the
 * reporter. No accountId, no clientKey of the report, no e-mail.
 * ------------------------------------------------------------------ */

export interface ParticipantView {
  participantToken: string
  role: ChatRole
  displayName: string | null
}

export interface ThreadSummary {
  threadId: number
  reportId: number
  me: ParticipantView
  other: ParticipantView
  /** Degraded by tier (174); null when the thread has no message yet. */
  lastMessageAt: string | null
  unreadCount: number
  /** Derived from the report at read time (173): resolved or hidden. */
  closed: boolean
}

export interface MessageView {
  messageId: number
  clientKey: string
  /** The sender's participantToken. */
  sender: string
  mine: boolean
  text: string | null
  purged: boolean
  /** degradeTimestamp(createdAt, tier) — ordering is by messageId (174). */
  createdAt: string
}

export interface MessagesPage {
  threadId: number
  closed: boolean
  tier: RiskTier
  messages: MessageView[]
}

export interface PostMessageResult {
  threadId: number
  message: MessageView
  /** True when the clientKey had already been accepted (172/137) — the
   *  controller answers 200 instead of 201. */
  replayed: boolean
}
