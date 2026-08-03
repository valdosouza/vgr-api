import { Router } from 'express'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import * as controller from '@modules/accounts/account.controller'

/**
 * App-plane auth (decisions 119-124), mounted under /app-auth — outside
 * /api, which is the panel plane guarded by authMiddleware.
 *
 * ⚠️ Provider login (Google/Apple/Facebook) and phone/WhatsApp OTP are NOT
 * here yet: both need an external verification adapter, and the OTP one
 * needs a commercial decision that has not been made (see the round-6
 * pending item). The domain side is built — `loginWithProvider` accepts an
 * already-verified identity — so wiring a verifier is additive.
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
 * /app-auth/refresh:
 *   post:
 *     summary: Rotates the refresh token; reuse revokes the whole family (decision 122)
 *     security: []
 *     tags: [AppAuth]
 */
router.post('/register', controller.register)
router.post('/login', controller.login)
router.post('/refresh', controller.refresh)

// Authenticated app-plane routes.
router.post('/sign-out-everywhere', appAuthMiddleware, controller.signOutEverywhere)

export default router
