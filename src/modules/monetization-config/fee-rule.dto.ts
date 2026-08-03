import { z } from 'zod'

export const feeRuleUpdateDto = z.object({
  feePercent: z.number().min(0).max(100),
  paymentModeAllowed: z.array(z.enum(['intermediated', 'peer_to_peer'])).min(1),
})

export type FeeRuleUpdateInput = z.infer<typeof feeRuleUpdateDto>
