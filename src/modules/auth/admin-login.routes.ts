import { Router } from 'express'
import * as controller from './admin-login.controller'
import * as recoveryController from './password-recovery.controller'
import * as twoFactorController from './two-factor.controller'

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

// 2FA enrollment (decision 114): guarded by the enroll-scope token issued
// at login — a full session never exists before enrollment completes.
router.post('/2fa/setup', twoFactorController.setup)
router.post('/2fa/activate', twoFactorController.activate)
router.post('/2fa/recover', twoFactorController.recover)

export default router
