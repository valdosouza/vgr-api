import { z } from 'zod'

/** Feed query string — coerced, since query params are strings. */
export const feedQueryDto = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  page: z.coerce.number().int().min(1).default(1),
  order: z.enum(['recency', 'relevance']).default('recency'),
})
