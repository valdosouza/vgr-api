import * as repository from '@modules/panic/responder-pool.repository'
import { ResponderPoolMembershipRow } from '@modules/panic/responder-pool.interface'

export async function requestResponderAuthorization(
  userId: number,
  criteriaNotes: string | null = null
): Promise<ResponderPoolMembershipRow> {
  return repository.createMembershipRequest(userId, criteriaNotes)
}

export async function listPendingResponderRequests(): Promise<ResponderPoolMembershipRow[]> {
  return repository.findPendingMemberships()
}

export async function resolveResponderRequest(id: number, approved: boolean, resolvedBy: number): Promise<void> {
  await repository.resolveMembership(id, approved, resolvedBy)
}

/** Consumed by PanicAlert routing (task 28) — never resolves to zero recipients on its own (decision 65 is enforced there). */
export async function findActiveResponders(): Promise<ResponderPoolMembershipRow[]> {
  return repository.findActiveMembers()
}
