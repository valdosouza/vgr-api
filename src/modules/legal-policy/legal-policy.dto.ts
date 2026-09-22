import { z } from 'zod'
import { pagedQueryDto } from '@shared/http/paged-query'

/**
 * List queries (PS0, decision 220): optional page/pageSize; `filter` is
 * matched on each resource's natural text columns (jurisdiction: code /
 * name; capability: capability / description; rule: capability /
 * jurisdiction_code / legal_basis). No `page` keeps the legacy shape.
 */
export const jurisdictionListQueryDto = pagedQueryDto

/** `jurisdiction` stays mandatory — the overview is per jurisdiction. */
export const capabilityListQueryDto = pagedQueryDto.extend({
  jurisdiction: z.string().min(1).max(10),
})

/** The pre-existing exact filters remain, alongside the text filter. */
export const ruleListQueryDto = pagedQueryDto.extend({
  capability: z.string().min(1).max(80).optional(),
  jurisdiction: z.string().min(1).max(10).optional(),
})

export type JurisdictionListQuery = z.infer<typeof jurisdictionListQueryDto>
export type CapabilityListQuery = z.infer<typeof capabilityListQueryDto>
export type RuleListQuery = z.infer<typeof ruleListQueryDto>

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
