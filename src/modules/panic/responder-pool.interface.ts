export type MembershipStatus = 'pending' | 'approved' | 'denied'

export interface ResponderPoolMembershipRow {
  id: number
  userId: number
  status: MembershipStatus
  /** Free text pending decision 52's resolution — no eligibility rules
   *  are decided yet, so this is stored and displayed as-is, not validated. */
  criteriaNotes: string | null
  requestedAt: Date
  resolvedAt: Date | null
  resolvedBy: number | null
}
