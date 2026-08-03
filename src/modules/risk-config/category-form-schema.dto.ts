import { z } from 'zod'

export const categoryFormSchemaUpdateDto = z.object({
  fields: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['string', 'number', 'boolean', 'date']),
        required: z.boolean(),
      })
    )
    .min(1),
})

export type CategoryFormSchemaUpdateInput = z.infer<typeof categoryFormSchemaUpdateDto>
