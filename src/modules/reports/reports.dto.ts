import { z } from 'zod'
import { CATEGORIES, SUBJECTS } from '@modules/reports/reports.interface'

/**
 * SubmitReport body. Taxonomy rules (decisions 9/140): exactly one of
 * category/freeTag; subject always required. The XOR is validated here so
 * the client gets field-level codes (decision 83).
 */
export const submitReportDto = z
  .object({
    clientKey: z.string().uuid(),
    category: z.enum(CATEGORIES).nullish(),
    freeTag: z.string().trim().min(1).max(50).nullish(),
    subject: z.enum(SUBJECTS),
    detailFields: z.record(z.unknown()).nullish(),
    position: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    anonymous: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    const hasCategory = body.category != null
    const hasFreeTag = body.freeTag != null
    if (hasCategory === hasFreeTag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category'],
        message: 'Provide exactly one of category or freeTag',
      })
    }
  })

export type SubmitReportBody = z.infer<typeof submitReportDto>
