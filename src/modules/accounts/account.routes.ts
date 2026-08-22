import { Router } from 'express'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import * as controller from '@modules/accounts/account.controller'

/**
 * App-plane auth (decisions 119-124), mounted under /app-auth — outside
 * /api, which is the panel plane guarded by authMiddleware.
 *
 * ⚠️ Phone/WhatsApp OTP is NOT here: it needs a commercial decision that
 * has not been made (round-6 pending item 1). Google login IS wired
 * (decision 152) — Apple/Facebook still answer 422 `NOT_AVAILABLE` from
 * `verifyProviderToken` until their credentials exist.
 */
const router = Router()

/**
 * @swagger
 * /app-auth/register:
 *   post:
 *     summary: Registers an app user with email+password and recorded consent (decisions 119, 123)
 *     security: []
 *     tags: [AppAuth]
 * /app-auth/login:
 *   post:
 *     summary: Email+password login, optional TOTP; returns access + rotating refresh (decisions 122, 124)
 *     security: []
 *     tags: [AppAuth]
 * /app-auth/login-provider:
 *   post:
 *     summary: Social login (Google wired; Apple/Facebook 422 NOT_AVAILABLE) — verifies the token server-side (decisions 119/152)
 *     security: []
 *     tags: [AppAuth]
 * /app-auth/refresh:
 *   post:
 *     summary: Rotates the refresh token; reuse revokes the whole family (decision 122)
 *     security: []
 *     tags: [AppAuth]
 * /app-auth/verify-email/send:
 *   post:
 *     summary: Sends a 6-digit email verification code, reusing the panel's mailer (decision 151)
 *     tags: [AppAuth]
 * /app-auth/verify-email/confirm:
 *   post:
 *     summary: Confirms the code — required before consequential actions, never before reporting (decision 123)
 *     tags: [AppAuth]
 */
router.post('/register', controller.register)
router.post('/login', controller.login)
router.post('/login-provider', controller.loginWithProvider)
router.post('/refresh', controller.refresh)

// Authenticated app-plane routes.
router.post('/sign-out-everywhere', appAuthMiddleware, controller.signOutEverywhere)
router.post('/verify-email/send', appAuthMiddleware, controller.sendEmailVerification)
router.post('/verify-email/confirm', appAuthMiddleware, controller.confirmEmailVerification)

export default router
