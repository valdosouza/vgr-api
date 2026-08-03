import { Router } from 'express'
import { requireAdmin } from '@gateway/require-admin.middleware'
import * as controller from './responder-pool.controller'

const router = Router()

/**
 * @swagger
 * /api/panic/responder-pool/{id}/resolve:
 *   put:
 *     summary: Approve or deny a pending Authorized Responder request (admin-only, decisions 51-52)
 *     tags: [ResponderPool]
 */
router.post('/', controller.create)
router.get('/', requireAdmin, controller.list)
router.put('/:id/resolve', requireAdmin, controller.resolve)

export default router
