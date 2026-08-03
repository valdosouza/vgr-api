import * as repository from '@modules/legal-policy/legal-policy.repository'
import {
  CapabilityOverviewRow,
  JurisdictionAdminRow,
  LegalRuleProposal,
  LegalRuleRow,
} from '@modules/legal-policy/legal-policy.interface'
import { CAPABILITY_REQUIRES, Capability, isKnownCapability } from '@shared/legal/capabilities'
import { invalidateLegalGateCache } from '@shared/legal/legal-gate'
import { OperationalState } from '@shared/legal/legal-gate.interface'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * Administration of the Legal Gate (decisions 106-108). The gate READS in
 * @shared/legal; every WRITE goes through here, under the dual-control
 * discipline of decision 107: one person proposes, a different person
 * approves, and only 'active' rules are enforced.
 */

// ---------------------------------------------------------------- rules

export async function listRules(filter: {
  capability?: string
  jurisdictionCode?: string
}): Promise<LegalRuleRow[]> {
  return repository.listRules(filter)
}

export async function proposeRule(
  proposal: LegalRuleProposal,
  proposerId: number
): Promise<LegalRuleRow> {
  if (!isKnownCapability(proposal.capability)) {
    throw new HttpError(422, 'Unknown capability', undefined, ErrorCodes.BUSINESS_RULE, {
      capability: proposal.capability,
    })
  }
  if (!(await repository.findJurisdictionByCode(proposal.jurisdictionCode))) {
    throw new HttpError(404, 'Jurisdiction not found', undefined, ErrorCodes.NOT_FOUND)
  }
  // One open proposal per capability x jurisdiction: two competing drafts
  // would make "what am I approving?" ambiguous for the second approver.
  if (await repository.findOpenProposal(proposal.capability, proposal.jurisdictionCode)) {
    throw new HttpError(
      409,
      'An open proposal already exists for this capability and jurisdiction',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }
  const id = await repository.insertProposal(proposal, proposerId)
  const created = await repository.findRuleById(id)
  if (!created) {
    throw new HttpError(500, 'Proposal not persisted', undefined, ErrorCodes.INTERNAL)
  }
  return created
}

/** Decision 98: reward.monetary must never be allowed where
 *  reward.mediation is not — validated on promotion, both directions. */
async function assertDependenciesCoherent(rule: LegalRuleRow): Promise<void> {
  const required = CAPABILITY_REQUIRES[rule.capability as Capability]
  if (rule.status === 'allowed' && required) {
    const dep = await repository.findActiveAllowedRule(required, rule.jurisdictionCode)
    if (!dep) {
      throw new HttpError(
        422,
        'Required capability is not allowed in this jurisdiction',
        undefined,
        ErrorCodes.BUSINESS_RULE,
        { capability: rule.capability, requires: required }
      )
    }
  }
  if (rule.status !== 'allowed') {
    const dependents = Object.entries(CAPABILITY_REQUIRES)
      .filter(([, requires]) => requires === rule.capability)
      .map(([dependent]) => dependent)
    for (const dependent of dependents) {
      if (await repository.findActiveAllowedRule(dependent, rule.jurisdictionCode)) {
        throw new HttpError(
          422,
          'A capability that depends on this one is still allowed in this jurisdiction',
          undefined,
          ErrorCodes.BUSINESS_RULE,
          { capability: rule.capability, dependent }
        )
      }
    }
  }
}

export async function approveRule(id: number, approverId: number): Promise<LegalRuleRow> {
  const rule = await repository.findRuleById(id)
  if (!rule) {
    throw new HttpError(404, 'Rule not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (rule.ruleState !== 'proposed') {
    throw new HttpError(409, 'Rule is not awaiting approval', undefined, ErrorCodes.BUSINESS_RULE)
  }
  // The heart of decision 107: whoever proposed cannot be the approver.
  if (rule.proposedBy === approverId) {
    throw new HttpError(
      409,
      'The proposer cannot approve their own rule',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }
  await assertDependenciesCoherent(rule)
  await repository.activateRule(id, rule, approverId)
  invalidateLegalGateCache()
  const activated = await repository.findRuleById(id)
  return activated ?? { ...rule, ruleState: 'active', approvedBy: approverId }
}

export async function rejectRule(id: number, actorId: number): Promise<LegalRuleRow> {
  const rule = await repository.findRuleById(id)
  if (!rule) {
    throw new HttpError(404, 'Rule not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (rule.ruleState !== 'proposed') {
    throw new HttpError(409, 'Rule is not awaiting approval', undefined, ErrorCodes.BUSINESS_RULE)
  }
  await repository.rejectRule(id, actorId)
  const rejected = await repository.findRuleById(id)
  return rejected ?? { ...rule, ruleState: 'rejected' }
}

// -------------------------------------------------------- jurisdictions

const STATE_RANK: Record<OperationalState, number> = { live: 0, restricted: 1, suspended: 2 }

export async function listJurisdictions(): Promise<JurisdictionAdminRow[]> {
  return repository.listJurisdictions()
}

/**
 * Decision 107, generalized: shut down fast, turn back on slowly.
 * Tightening (toward 'suspended') applies immediately — one person.
 * Loosening (toward 'live') only records a pending state; a DIFFERENT
 * approver confirms it. Re-proposing the current state clears a pending.
 */
export async function requestOperationalState(
  code: string,
  target: OperationalState,
  actorId: number
): Promise<JurisdictionAdminRow> {
  const jurisdiction = await repository.findJurisdictionByCode(code)
  if (!jurisdiction) {
    throw new HttpError(404, 'Jurisdiction not found', undefined, ErrorCodes.NOT_FOUND)
  }

  if (STATE_RANK[target] >= STATE_RANK[jurisdiction.operationalState]) {
    await repository.applyOperationalState(code, target)
  } else {
    await repository.setPendingState(code, target, actorId)
  }
  const updated = await repository.findJurisdictionByCode(code)
  return updated ?? jurisdiction
}

export async function confirmOperationalState(
  code: string,
  approverId: number
): Promise<JurisdictionAdminRow> {
  const jurisdiction = await repository.findJurisdictionByCode(code)
  if (!jurisdiction) {
    throw new HttpError(404, 'Jurisdiction not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (!jurisdiction.pendingState) {
    throw new HttpError(409, 'No pending state change to confirm', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (jurisdiction.pendingBy === approverId) {
    throw new HttpError(
      409,
      'The proposer cannot confirm their own state change',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }
  await repository.applyOperationalState(code, jurisdiction.pendingState)
  const updated = await repository.findJurisdictionByCode(code)
  return updated ?? jurisdiction
}

// --------------------------------------------------------- capabilities

export async function listCapabilities(jurisdictionCode: string): Promise<CapabilityOverviewRow[]> {
  if (!(await repository.findJurisdictionByCode(jurisdictionCode))) {
    throw new HttpError(404, 'Jurisdiction not found', undefined, ErrorCodes.NOT_FOUND)
  }
  return repository.listCapabilityOverview(jurisdictionCode)
}
