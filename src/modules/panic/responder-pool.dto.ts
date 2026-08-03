import { z } from 'zod'

export const responderPoolRequestDto = z.object({
  criteriaNotes: z.string().optional(),
})

export type ResponderPoolRequestInput = z.infer<typeof responderPoolRequestDto>

export const responderPoolResolveDto = z.object({
  approved: z.boolean(),
})

export type ResponderPoolResolveInput = z.infer<typeof responderPoolResolveDto>
