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
