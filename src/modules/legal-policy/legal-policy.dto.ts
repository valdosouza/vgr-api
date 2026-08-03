import { z } from 'zod'

/** Propose a rule (decision 107 — born 'proposed', enforced only after a
 *  different user approves). Reason is mandatory whenever not allowed
 *  (decision 78) — mirrored by the DB CHECK in migration 022. */
export const legalRuleProposalDto = z
  .object({
    capability: z.string().min(3).max(80),
    jurisdictionCode: z.string().min(2).max(10),
    status: z.enum(['allowed', 'restricted', 'blocked']),
    reason: z.enum(['no_control', 'legislation', 'self_preservation']).nullish(),
    legalBasis: z.string().max(4000).nullish(),
    reviewState: z.enum(['none', 'ai_assessed', 'counsel_confirmed']).default('none'),
    /** Decision 108: every rule expires — 180 days unless shortened. */
    expiresInDays: z.number().int().min(1).max(730).default(180),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'allowed' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason is required when status is not allowed',
      })
    }
  })
  .transform((value) => ({
    ...value,
    reason: value.status === 'allowed' ? null : value.reason ?? null,
    legalBasis: value.legalBasis ?? null,
  }))

export type LegalRuleProposalInput = z.infer<typeof legalRuleProposalDto>

/** Kill-switch / state-change request (decision 107). */
export const jurisdictionStateDto = z.object({
  state: z.enum(['live', 'restricted', 'suspended']),
})

export type JurisdictionStateInput = z.infer<typeof jurisdictionStateDto>
