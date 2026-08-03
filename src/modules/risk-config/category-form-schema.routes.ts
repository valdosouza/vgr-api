import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys } from '@shared/acl/privileges'
import * as controller from './category-form-schema.controller'

const router = Router()

/**
 * @swagger
 * /api/category-forms/{category}:
 *   put:
 *     summary: Set the detail-field schema for a Category (admin-only, decision 47)
 *     tags: [CategoryForms]
 */
router.get('/', requirePrivilege(InterfaceKeys.CATEGORY_FORMS), controller.list)
router.put('/:category', requirePrivilege(InterfaceKeys.CATEGORY_FORMS), controller.update)

export default router
