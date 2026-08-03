import { Router } from 'express'
import { requireAdmin } from '@gateway/require-admin.middleware'
import * as controller from './dual-control.controller'

const router = Router()

/**
 * @swagger
 * /api/dual-control-access/{id}/approvals:
 *   post:
 *     summary: Record one admin's approval toward the 2-distinct-approver decryption gate (decision 45)
 *     tags: [DualControlAccess]
 */
router.post('/', requireAdmin, controller.create)
router.get('/', requireAdmin, controller.list)
router.post('/:id/approvals', requireAdmin, controller.approve)

export default router
