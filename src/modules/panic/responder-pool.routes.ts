import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from './responder-pool.controller'

/**
 * Admin-only plane (`/api/panic/responder-pool`) — team actions on the
 * queue: list pending requests, approve/deny. `resolved_by` here is
 * correctly the ADMIN's req.user.userId.
 *
 * The POST (a mobile user requesting to become a responder, decision 51)
 * used to live here too, but a mobile user carries no admin JWT and could
 * never reach it — plane-positioning bug fixed in PP1 of plano-panico.md
 * by moving it to the APP plane: see responder-pool-app.routes.ts,
 * mounted at POST /app-panic/responder-pool.
 */
const router = Router()

/**
 * @swagger
 * /api/panic/responder-pool:
 *   get:
 *     summary: Lists pending Authorized Responder requests (admin-only, decisions 51-52)
 *     tags: [ResponderPool]
 * /api/panic/responder-pool/{id}/resolve:
 *   put:
 *     summary: Approve or deny a pending Authorized Responder request (admin-only, decisions 51-52)
 *     tags: [ResponderPool]
 */
router.get('/', requirePrivilege(InterfaceKeys.PANIC_RESPONDERS), controller.list)
router.put('/:id/resolve', requirePrivilege(InterfaceKeys.PANIC_RESPONDERS, Privileges.UPDATE), controller.resolve)

export default router
