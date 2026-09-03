/**
 * The actions the administrative trail records (decision 116; `read`
 * added by decision 130 for evidence media and extended by 159/166 to
 * the case detail and exact position). The runtime tuple lives in its
 * OWN file, apart from admin-audit.ts: route specs automock that module
 * (jest turns arrays into `[]` under automock) and the B5 filter DTO
 * needs the real list to validate `action`.
 */
export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'grant', 'state_change', 'read'] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]
