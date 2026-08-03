import { Router } from 'express'
import * as controller from './core.controller'

const router = Router()

/**
 * @swagger
 * /api/core/menus:
 *   get:
 *     summary: Menu tree already filtered by the session user's VIEW grants (decision 71) — the app renders it as-is
 *     tags: [Core]
 */
// No privilege guard: menus/me/preferences are the session's own data —
// an empty menu is the correct answer for a user with no grants.
router.get('/menus', controller.menus)
// All grants keyed by interface, INCLUDING kind 'R' resources that never
// reach the menu (decision 93) — the app's SessionAccess consumes this.
router.get('/permissions', controller.permissions)
router.get('/me', controller.me)
router.put('/preferences', controller.savePreferences)

export default router
