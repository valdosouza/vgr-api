export type MembershipStatus = 'pending' | 'approved' | 'denied'

export interface ResponderPoolMembershipRow {
  id: number
  /** tb_user_account.id (an APP account) — the requester's identity,
   *  written from req.appAccountId under /app-panic/responder-pool
   *  (plane fix, PP1 of plano-panico.md). NOT a tb_user (admin) id. */
  userId: number
  status: MembershipStatus
  /** Free text — decision 190 closes decision 52 with NO codified
   *  eligibility rule: an admin's free human judgment, same as before. */
  criteriaNotes: string | null
  requestedAt: Date
  resolvedAt: Date | null
  /** tb_user.id of the resolving ADMIN — set only by PUT :id/resolve
   *  under the admin-only /api plane, unaffected by the fix above. */
  resolvedBy: number | null
}
