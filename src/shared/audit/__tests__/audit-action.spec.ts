import { AUDIT_ACTIONS } from '@shared/audit/audit-action'

/** The runtime tuple behind the `AuditAction` type — B5's filter DTO
 *  validates `action` against it (decisions 116/166). It lives in its own
 *  file because route specs automock `admin-audit.ts` (jest turns arrays
 *  into `[]` there) and the DTO must keep the real list. */
describe('shared/audit/audit-action', () => {
  it('lists exactly the six actions the trail records, in a stable order', () => {
    expect(AUDIT_ACTIONS).toEqual(['create', 'update', 'delete', 'grant', 'state_change', 'read'])
  })
})
