import { z } from 'zod'
import { HELP_TYPES } from '@modules/help-offers/help-offers.interface'

/** Decisions 208/213: one to five fronts of decision 10, no repeats. */
export const helpTypesDto = z
  .array(z.enum(HELP_TYPES))
  .min(1)
  .max(HELP_TYPES.length)
  .refine((types) => new Set(types).size === types.length, {
    message: 'helpTypes must not repeat',
  })

export const submitHelpOfferDto = z.object({
  reportId: z.number().int().positive(),
  helpTypes: helpTypesDto,
  /** Identification is the helper's choice (decision 6). */
  anonymous: z.boolean().default(false),
})

/** PUT /app-help-offers/:id/types (decision 211). */
export const updateHelpOfferTypesDto = z.object({
  helpTypes: helpTypesDto,
})
