import { z } from 'zod'

export const systemModuleSaveDto = z.object({
  description: z.string().min(2).max(120),
  i18nKey: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, 'Must be a lower_snake_case identifier')
    .nullish()
    .transform((v) => v ?? null),
  imageIcon: z
    .string()
    .max(60)
    .nullish()
    .transform((v) => v ?? null),
  position: z.number().int().min(0).default(0),
  /** Menu order = array order. */
  interfaceIds: z.array(z.number().int().positive()).default([]),
})

export type SystemModuleSaveInput = z.infer<typeof systemModuleSaveDto>
