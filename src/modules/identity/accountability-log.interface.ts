/** Append-only audit trail for anonymous actors (decision 6). Never
 *  exposed via any controller/DTO — see `accountability-log.repository.ts`. */
export interface AccountabilityLogEntryRow {
  id: number
  actionType: string
  ipAddress: string
  metadata: Record<string, unknown> | null
  createdAt: Date
}
