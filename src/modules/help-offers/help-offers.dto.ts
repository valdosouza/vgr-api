import { z } from 'zod'
import { HELP_TYPES } from '@modules/help-offers/help-offers.interface'

export const submitHelpOfferDto = z.object({
  reportId: z.number().int().positive(),
  helpType: z.enum(HELP_TYPES),
  /** Identification is the helper's choice (decision 6). */
  anonymous: z.boolean().default(false),
})
