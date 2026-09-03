import { z } from 'zod'
import { AUDIT_ACTIONS } from '@shared/audit/audit-action'
import { queryDate } from '@shared/http/query-date'

/**
 * Trail list query (B5 — decision 166: not audited, so cheap and
 * precise). Query params arrive as strings: numbers are coerced,
 * `action` must be one of the AuditAction union (INVALID_OPTION
 * otherwise, decision 83), dates follow the shared B1 rule.
 */
export const auditListQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  actorId: z.coerce.number().int().min(1).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entity: z.string().min(1).max(40).optional(),
  entityId: z.string().min(1).max(40).optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
})

export type AuditListQuery = z.infer<typeof auditListQueryDto>
