import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/messaging/chat-admin.controller'

/**
 * Audited panel read of a case's chat (C3 of plano-chat.md — decision
 * 175), on the PANEL plane behind authMiddleware like all of /api.
 * Mounted by gateway/router.ts at /api/reports/:id/chat with
 * `mergeParams` so `:id` reaches the controller — the route lives in the
 * messaging module (it is the chat's data) and is NOT declared in
 * reports-admin.routes.ts: a module never imports another module, and
 * mounting from the gateway keeps reports -> messaging one-directional
 * (neither imports the other).
 *
 * Stacked guards, pattern of the exact position (159): `reports` VIEW
 * (the case is visible to this person) THEN `chat_evidence` VIEW — a kind
 * 'R' resource migration 044 grants to NOBODY by default (175, posture of
 * media_original / report_exact_position). READ ONLY: no POST, PUT or
 * DELETE exists here — the panel never posts, hides or deletes a message
 * (175); moderation by message reopens with "flag content" (161).
 */
const router = Router({ mergeParams: true })

/**
 * @swagger
 * /api/reports/{id}/chat:
 *   get:
 *     summary: Every chat thread of a case with participants resolved for the platform — needs the chat_evidence grant on top of reports; every read audited (decisions 175/166/60/160)
 *     tags: [Reports]
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 500, default: 200 }, description: messages per thread; hasMore flags a longer thread }
 */
router.get(
  '/',
  requirePrivilege(InterfaceKeys.REPORTS, Privileges.VIEW),
  requirePrivilege(InterfaceKeys.CHAT_EVIDENCE, Privileges.VIEW),
  controller.chatEvidence
)

export default router
