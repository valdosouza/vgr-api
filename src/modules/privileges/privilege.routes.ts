import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys } from '@shared/acl/privileges'
import * as controller from './privilege.controller'

const router = Router()

/**
 * @swagger
 * /api/privileges:
 *   get:
 *     summary: List the privilege catalog (decision 71; enforcement per decision 72)
 *     tags: [Privileges]
 */
router.use(requirePrivilege(InterfaceKeys.PRIVILEGES))
router.get('/', controller.list)
router.get('/:id', controller.get)
router.post('/', controller.create)
router.put('/:id', controller.update)
router.delete('/:id', controller.remove)

export default router
