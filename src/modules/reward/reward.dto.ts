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
