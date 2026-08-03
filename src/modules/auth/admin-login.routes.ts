import { Router } from 'express'
import * as controller from './admin-login.controller'
import * as recoveryController from './password-recovery.controller'

const router = Router()

/**
 * @swagger
 * /auth/admin-login:
 *   post:
 *     summary: Admin email/password login (decision 67) — issues the JWT needed for every /api/* admin-gated route
 *     security: []
 *     tags: [Auth]
 * /auth/recovery-password:
 *   post:
 *     summary: Emails a 6-digit recovery code, valid 15 minutes (always answers 200 — no user enumeration)
 *     security: []
 *     tags: [Auth]
 * /auth/change-password:
 *   post:
 *     summary: Sets a new password given email + valid recovery code
 *     security: []
 *     tags: [Auth]
 */
router.post('/admin-login', controller.login)
router.post('/recovery-password', recoveryController.recovery)
router.post('/change-password', recoveryController.change)

export default router
