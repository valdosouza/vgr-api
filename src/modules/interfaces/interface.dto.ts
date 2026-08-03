import { z } from 'zod'

export const interfaceSaveDto = z.object({
  description: z.string().min(2).max(120),
  // Same identifier discipline as the app's route map: lower_snake_case.
  i18nKey: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, 'Must be a lower_snake_case identifier'),
  groupDefault: z.string().min(1).max(60).default('General'),
  kind: z.enum(['T', 'R']).default('T'),
  position: z.number().int().min(0).default(0),
  privilegeIds: z.array(z.number().int().positive()).default([]),
})

export type InterfaceSaveInput = z.infer<typeof interfaceSaveDto>
