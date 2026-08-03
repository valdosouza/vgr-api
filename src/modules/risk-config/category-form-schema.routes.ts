import { Router } from 'express'
import { requireAdmin } from '@gateway/require-admin.middleware'
import * as controller from './category-form-schema.controller'

const router = Router()

/**
 * @swagger
 * /api/category-forms/{category}:
 *   put:
 *     summary: Set the detail-field schema for a Category (admin-only, decision 47)
 *     tags: [CategoryForms]
 */
router.get('/', requireAdmin, controller.list)
router.put('/:category', requireAdmin, controller.update)

export default router
