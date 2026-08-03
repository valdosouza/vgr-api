import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys } from '@shared/acl/privileges'
import * as controller from './interface.controller'

const router = Router()

/**
 * @swagger
 * /api/interfaces:
 *   get:
 *     summary: List the screen catalog with its cataloged privileges (decision 71)
 *     tags: [Interfaces]
 */
router.use(requirePrivilege(InterfaceKeys.INTERFACES))
router.get('/', controller.list)
router.get('/:id', controller.get)
router.post('/', controller.create)
router.put('/:id', controller.update)
router.delete('/:id', controller.remove)

export default router
