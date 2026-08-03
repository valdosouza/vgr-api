export type DualControlStatus = 'pending' | 'granted'

/**
 * Tracks the legal-basis + 2-distinct-approver gate for decrypting an
 * AccountabilityLogEntry (decision 45). `accountabilityLogEntryId` is a
 * plain reference — actual decryption/reveal of the entry's content is
 * out of scope until encryption itself is decided (no encryption exists
 * yet anywhere in this codebase); this module only builds the gate.
 */
export interface DualControlAccessRequestRow {
  id: number
  accountabilityLogEntryId: number
  legalBasis: string
  approverIds: string[]
  status: DualControlStatus
  createdAt: Date
}
