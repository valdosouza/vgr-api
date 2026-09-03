import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/reports/reports-admin.controller'

/**
 * Report search + case detail on the PANEL plane (B1 of
 * plano-moderacao-painel.md — decisions 159/160/165/166), mounted under
 * /api/reports behind authMiddleware like all of /api. The `reports`
 * VIEW grant searches and opens the detail (each detail read audited);
 * the EXACT position ADDITIONALLY needs `report_exact_position`, which
 * migration 038 grants to nobody by default (159 — stacked guards,
 * pattern of the media_original route). Freeze/unfreeze stay on
 * /api/case-freeze (141) — the detail screen embeds them.
 */
const router = Router()

/**
 * @swagger
 * /api/reports:
 *   get:
 *     summary: Paginated report search for the panel (decision 166 — not audited); position tier-degraded (135)
 *     tags: [Reports]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { in: query, name: id, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [open, resolved] } }
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: subject, schema: { type: string } }
 *       - { in: query, name: tier, schema: { type: string, enum: [low, medium, high] } }
 *       - { in: query, name: frozen, schema: { type: boolean } }
 *       - { in: query, name: hasMedia, schema: { type: boolean } }
 *       - { in: query, name: from, schema: { type: string }, description: ISO date-time or YYYY-MM-DD (inclusive) }
 *       - { in: query, name: to, schema: { type: string }, description: ISO date-time (inclusive) or YYYY-MM-DD (whole day) }
 * /api/reports/{id}:
 *   get:
 *     summary: Case detail for the panel — degraded position, identity only for identified actors; every read audited (decisions 159/160/166)
 *     tags: [Reports]
 * /api/reports/{id}/position:
 *   get:
 *     summary: EXACT position — needs the report_exact_position grant on top of reports; every read audited (decision 159)
 *     tags: [Reports]
 */
router.get('/', requirePrivilege(InterfaceKeys.REPORTS, Privileges.VIEW), controller.search)
router.get('/:id', requirePrivilege(InterfaceKeys.REPORTS, Privileges.VIEW), controller.detail)
router.get(
  '/:id/position',
  requirePrivilege(InterfaceKeys.REPORTS, Privileges.VIEW),
  requirePrivilege(InterfaceKeys.REPORT_EXACT_POSITION, Privileges.VIEW),
  controller.exactPosition
)

export default router
