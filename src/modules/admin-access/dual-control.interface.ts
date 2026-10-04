/** `void` = a request from before round 18 (decision 225): its approvers
 *  were typed into the request body, so it never counts as granted. */
export type DualControlStatus = 'pending' | 'granted' | 'void'

/**
 * The legal-basis + two-person gate for decrypting an AccountabilityLogEntry
 * (decision 45, made real by decisions 223–226). The log itself is
 * encrypted at rest since migration 024 (decisions 44/111); revealing an
 * entry is NOT built yet — decision 228 keeps it for its own round, so
 * nothing consumes `granted` today. This module only keeps the gate whole.
 *
 * Both people come from the panel session: `requestedBy` opened the request
 * (its first authorization) and `approvedBy`, a DIFFERENT user, granted it
 * (224). Names are the panel team's display names, never e-mails (227).
 */
export interface DualControlAccessRequestRow {
  id: number
  accountabilityLogEntryId: number
  legalBasis: string
  status: DualControlStatus
  /** Null only on a voided pre-round-18 request (225). */
  requestedBy: number | null
  requestedByName: string | null
  approvedBy: number | null
  approvedByName: string | null
  approvedAt: Date | null
  createdAt: Date
}
