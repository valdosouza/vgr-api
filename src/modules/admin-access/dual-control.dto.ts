import { z } from 'zod'

export const dualControlCreateDto = z.object({
  accountabilityLogEntryId: z.number().int(),
  legalBasis: z.string().min(1),
})

export type DualControlCreateInput = z.infer<typeof dualControlCreateDto>

export const dualControlApprovalDto = z.object({
  approverId: z.string().min(1),
})

export type DualControlApprovalInput = z.infer<typeof dualControlApprovalDto>
