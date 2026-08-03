import { z } from 'zod'

export const riskTierConfigUpdateDto = z.object({
  tier: z.enum(['low', 'medium', 'high']),
})

export type RiskTierConfigUpdateInput = z.infer<typeof riskTierConfigUpdateDto>
