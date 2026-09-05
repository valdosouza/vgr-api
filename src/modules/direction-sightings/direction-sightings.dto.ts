import { z } from 'zod'
import { DIRECTIONS } from '@modules/direction-sightings/direction-sightings.interface'

/**
 * LogDirectionSighting body (decisions 200/205/28). `reportId` is inline
 * in the body rather than a route param — this is a flat top-level route
 * (see direction-sightings.routes.ts's own comment for why), mirroring
 * submitHelpOfferDto's shape. `clientKey` is the replay-safety idempotency
 * key (137/28), not a bearer secret (see the interface file's comment).
 */
export const logDirectionSightingDto = z.object({
  reportId: z.number().int().positive(),
  direction: z.enum(DIRECTIONS),
  clientKey: z.string().uuid(),
})

export type LogDirectionSightingBody = z.infer<typeof logDirectionSightingDto>
