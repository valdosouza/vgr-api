import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/admin-audit/admin-audit.controller'

/**
 * Administrative trail READ (B5 of plano-moderacao-painel.md — decisions
 * 116/158/165/166), mounted under /api/admin-audit behind authMiddleware
 * like all of /api. Every route is a GET under the `admin_audit` VIEW
 * grant (migration 042). There is NO write route and there never will
 * be (116: append-only — the only writer is shared/audit/admin-audit.ts).
 * Reading the trail is not audited (166).
 */
const router = Router()

/**
 * @swagger
 * /api/admin-audit:
 *   get:
 *     summary: Paginated administrative trail — who/what/when, no ip; NOT audited (decisions 116/166)
 *     tags: [Admin Audit]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100, default: 50 } }
 *       - { in: query, name: actorId, schema: { type: integer } }
 *       - { in: query, name: action, schema: { type: string, enum: [create, update, delete, grant, state_change, read] } }
 *       - { in: query, name: entity, schema: { type: string, maxLength: 40 } }
 *       - { in: query, name: entityId, schema: { type: string, maxLength: 40 } }
 *       - { in: query, name: from, schema: { type: string }, description: ISO date-time or YYYY-MM-DD (inclusive) }
 *       - { in: query, name: to, schema: { type: string }, description: ISO date-time (inclusive) or YYYY-MM-DD (whole day) }
 * /api/admin-audit/facets:
 *   get:
 *     summary: DISTINCT actions and entities present in the trail (the screen's dropdowns)
 *     tags: [Admin Audit]
 * /api/admin-audit/{id}:
 *   get:
 *     summary: One trail entry — the ONLY response carrying the operator ip (personal data); NOT audited
 *     tags: [Admin Audit]
 */
router.get('/', requirePrivilege(InterfaceKeys.ADMIN_AUDIT, Privileges.VIEW), controller.list)
// Facets BEFORE /:id so the literal segment never parses as an id.
router.get('/facets', requirePrivilege(InterfaceKeys.ADMIN_AUDIT, Privileges.VIEW), controller.facets)
router.get('/:id', requirePrivilege(InterfaceKeys.ADMIN_AUDIT, Privileges.VIEW), controller.detail)

export default router
