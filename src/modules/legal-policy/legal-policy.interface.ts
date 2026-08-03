import {
  BlockReason,
  CapabilityStatus,
  OperationalState,
} from '@shared/legal/legal-gate.interface'

/** Full rule row as the admin screens see it (tb_legal_rule, migration 022). */
export interface LegalRuleRow {
  id: number
  capability: string
  jurisdictionCode: string
  version: number
  status: CapabilityStatus
  reason: BlockReason | null
  legalBasis: string | null
  reviewState: 'none' | 'ai_assessed' | 'counsel_confirmed'
  ruleState: 'proposed' | 'active' | 'rejected' | 'superseded'
  effectiveFrom: Date | null
  expiresAt: Date | null
  proposedBy: number
  approvedBy: number | null
  createdAt: Date
  decidedAt: Date | null
}

export interface LegalRuleProposal {
  capability: string
  jurisdictionCode: string
  status: CapabilityStatus
  reason: BlockReason | null
  legalBasis: string | null
  reviewState: 'none' | 'ai_assessed' | 'counsel_confirmed'
  /** Decision 108 — default 180; expiry is set from proposal time (the
   *  conservative end: approving later only shortens the window). */
  expiresInDays: number
}

/** Catalog row joined with the current active rule for one jurisdiction. */
export interface CapabilityOverviewRow {
  capability: string
  description: string
  module: string
  /** Verdict the gate would give today: rule status or 'unreviewed'. */
  effectiveStatus: CapabilityStatus | 'unreviewed'
  activeRule: Pick<LegalRuleRow, 'id' | 'version' | 'status' | 'reason' | 'reviewState' | 'expiresAt'> | null
}

export interface JurisdictionAdminRow {
  code: string
  name: string
  operationalState: OperationalState
  isSandbox: boolean
  pendingState: OperationalState | null
  pendingBy: number | null
}
