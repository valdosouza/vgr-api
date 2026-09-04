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

/** Consumed by PanicAlert routing (panic-alert.service.triggerAlert, PP1
 *  of plano-panico.md) — the caller snapshots this list into
 *  tb_panic_alert_recipient at trigger time; an empty list is never
 *  refused HERE (decision 65's "never fail for a missing recipient" is
 *  enforced by the caller, not by this read). */
export async function findActiveResponders(): Promise<ResponderPoolMembershipRow[]> {
  return repository.findActiveMembers()
}
