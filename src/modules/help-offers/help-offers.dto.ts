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
  /** Identification is the helper's EXPLICIT choice (decisions 6/237):
   *  absent = hidden, so a client that never asks keeps the helper
   *  private. High tier masks the name even when sent false (40/60/238). */
  anonymous: z.boolean().default(true),
})

/** PUT /app-help-offers/:id/types (decision 211). */
export const updateHelpOfferTypesDto = z.object({
  helpTypes: helpTypesDto,
})
