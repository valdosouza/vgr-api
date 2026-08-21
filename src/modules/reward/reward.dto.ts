import { z } from 'zod'

export const createRewardOfferDto = z.object({
  amountCents: z.number().int().positive(),
})

export const reserveRewardDto = z.object({
  noReturnNoticeVersion: z.string().min(1),
  payerTaxId: z.string().min(11).max(14),
  payerName: z.string().min(1),
  recipients: z
    .array(
      z.object({
        helpOfferId: z.number().int().positive(),
        amountCents: z.number().int().positive(),
      })
    )
    .min(1),
})

export const resolveRewardDto = z.object({
  outcome: z.enum(['fulfilled', 'not_fulfilled']),
})

/**
 * KYC data the rail needs to open the helper's subconta. Passed THROUGH to
 * the rail and never stored by the VGR (only the opaque railRecipientId
 * is) — decisions 60/82 govern disclosure to other parties, not what the
 * helper gives their own PSP. monthlyIncome is in the rail's currency unit
 * (not cents) — it is declarative KYC data, not a money movement.
 */
export const onboardRecipientDto = z.object({
  legalName: z.string().min(1),
  email: z.string().email(),
  taxId: z.string().min(11).max(14),
  mobilePhone: z.string().min(10).max(13),
  monthlyIncome: z.number().positive(),
  address: z.object({
    street: z.string().min(1),
    number: z.string().min(1),
    neighborhood: z.string().min(1),
    postalCode: z.string().min(8).max(9),
  }),
})
