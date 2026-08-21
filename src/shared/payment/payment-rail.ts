import { paymentConfig } from '@shared/config/env'
import { AsaasPaymentRail } from '@shared/payment/asaas-payment-rail'

/**
 * The PaymentRail port (decision 96, plano-psp-requisitos.md) — same
 * pattern as BlobStore (decision 126) and the encapsulation rule of
 * decision 143: no concept of the underlying rail (Pix, walletId, escrow
 * id) ever leaks into entities/DTOs/tables. Swapping PSP or adding a
 * second jurisdiction's adapter is a config change plus a class, never a
 * rewrite.
 *
 * Shape follows the contract closed by decision 100: the rail retains the
 * payer's charge, split across N recipients (decision 30c); the rail is
 * later instructed to either release to the recipients or refund the
 * payer — the VGR never becomes the account of record for the money in
 * between (decision 84, custody zero).
 *
 * Method names follow the vocabulary decision 87 mandates for this port
 * once card pre-auth was dropped (decision 95): `reserve` / `capture` /
 * `cancel`.
 *
 * ⚠️ Several methods carry an ASSUMPTION not yet confirmed with a PSP (see
 * asaas-payment-rail.ts header) — checklist items B2–B4 of
 * plano-psp-requisitos.md are still open. Do not wire this port into a
 * real charge flow before that confirmation lands; a wrong assumption
 * here moves real money.
 *
 * `reserve` requires `recipients` up front (Asaas fixes split at charge
 * creation). Decision 147 makes this the product rule too: the reward's
 * recipient set is fixed when the reserve is created, not discovered
 * later by mediation — see that decision for the reasoning.
 */
export interface PaymentRecipient {
  /** Opaque id the rail assigns to an onboarded recipient (helper). */
  railRecipientId: string
}

export interface RetainedCharge {
  /** Opaque id the rail assigns to the retained charge — never a Pix key,
   *  never an account number. */
  railChargeId: string
}

export type RetentionState = 'retained' | 'released' | 'refunded' | 'unknown'

export interface RecipientOnboardingInput {
  legalName: string
  email: string
  taxId: string
  mobilePhone: string
  monthlyIncome: number
  address: {
    street: string
    number: string
    neighborhood: string
    postalCode: string
  }
}

export interface RetainedChargeInput {
  amountCents: number
  payerTaxId: string
  payerName: string
  /** Split targets — decision 30(c) allows more than one simultaneous
   *  recipient for the same reward. */
  recipients: Array<{ railRecipientId: string; amountCents: number }>
}

export interface PaymentRail {
  onboardRecipient(input: RecipientOnboardingInput): Promise<PaymentRecipient>
  /** Retains the payer's charge — decision 87's "reserve". Recipients are
   *  required here (see the open-tension note above), not at capture. */
  reserve(input: RetainedChargeInput): Promise<RetainedCharge>
  /** Instructs the rail to release the retained amount to the recipients
   *  already fixed at reserve() — decision 87's "capture". */
  capture(railChargeId: string): Promise<void>
  /** Instructs the rail to return the retained amount to the payer —
   *  decision 87's "cancel". */
  cancel(railChargeId: string): Promise<void>
  getRetentionState(railChargeId: string): Promise<RetentionState>
}

let instance: PaymentRail | null = null

/** Backend selected by PAYMENT_RAIL (decision 96): only 'asaas' for now. */
export function paymentRail(): PaymentRail {
  if (!instance) {
    const config = paymentConfig()
    instance = new AsaasPaymentRail(config.asaas)
  }
  return instance
}

/** Tests swap backends via env — reset the memoized instance with it. */
export function resetPaymentRailForTests(): void {
  instance = null
}
