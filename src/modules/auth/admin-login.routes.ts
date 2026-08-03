import { Router } from 'express'
import * as controller from './admin-login.controller'

const router = Router()

/**
 * @swagger
 * /auth/admin-login:
 *   post:
 *     summary: Admin email/password login (decision 67) — issues the JWT needed for every /api/* admin-gated route
 *     security: []
 *     tags: [Auth]
 */
router.post('/admin-login', controller.login)

export default router
