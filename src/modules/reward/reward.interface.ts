export type GuaranteeMode = 'none' | 'reserved'
export type RewardOfferStatus = 'open' | 'reserved' | 'released' | 'refunded'
export type MediationOutcome = 'fulfilled' | 'not_fulfilled'

export interface RewardOfferRow {
  id: number
  reportId: number
  amountCents: number
  guaranteeMode: GuaranteeMode
  status: RewardOfferStatus
  railChargeId: string | null
  noReturnNoticeVersion: string
  /** Decision 150: mediation-criteria version active at reserve time. */
  criteriaVersion: string
  createdAt: Date
  resolvedAt: Date | null
}

export interface RewardRecipientRow {
  id: number
  rewardOfferId: number
  helpOfferId: number
  amountCents: number
  status: 'pending' | 'paid'
}

export interface CreateOfferInput {
  reportId: number
  amountCents: number
}

export interface CreateOfferContext {
  accountId: number
}

/**
 * Decision 147: the recipient set is fixed HERE, not discovered later by
 * mediation. payerTaxId/payerName are the denunciante's real Pix payer
 * identity — required by the rail (Asaas needs a `customer`), and separate
 * from what the helper or the public ever sees (decisions 60/82 govern
 * disclosure TO OTHER PARTIES, not what the payer gives their own PSP).
 */
export interface ReserveInput {
  reportId: number
  noReturnNoticeVersion: string
  payerTaxId: string
  payerName: string
  recipients: Array<{ helpOfferId: number; amountCents: number }>
}

export interface ReserveContext {
  accountId: number
}

export interface ResolveContext {
  userId: number
}

export interface OnboardContext {
  accountId: number
}

export type ResolutionStatus = 'proposed' | 'approved' | 'executed' | 'cancelled'

export interface ResolutionRow {
  id: number
  rewardOfferId: number
  outcome: MediationOutcome
  reason: string
  criteriaVersion: string
  proposedBy: number
  proposedAt: Date
  approvedBy: number | null
  approvedAt: Date | null
  windowEndsAt: Date | null
  executedAt: Date | null
  status: ResolutionStatus
}

export interface CriteriaRow {
  id: number
  version: string
  body: string
  publishedBy: number
  publishedAt: Date
}

export interface ContestRow {
  id: number
  resolutionId: number
  accountId: number
  body: string
  status: 'open' | 'closed'
  closedBy: number | null
  closedNote: string | null
  createdAt: Date
  closedAt: Date | null
}

export type MediationEvent =
  | 'proposed'
  | 'approved'
  | 'contested'
  | 'contest_closed'
  | 'cancelled'
  | 'executed'
