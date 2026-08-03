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

/** Editable surface (R3, decision 19): the taxonomy axes and the position
 *  are immutable; only the reporter's own words change. */
export const editReportDto = z
  .object({
    freeTag: z.string().trim().min(1).max(50).optional(),
    detailFields: z.record(z.unknown()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to edit' })

/** Panel freeze/unfreeze bodies (decision 141): reason is MANDATORY —
 *  the writ/case number that justifies touching retention. */
export const freezeReasonDto = z.object({
  reason: z.string().trim().min(3).max(120),
})
