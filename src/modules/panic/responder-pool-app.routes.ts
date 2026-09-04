import { Router } from 'express'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import * as controller from './responder-pool.controller'

/**
 * APP plane (`/app-panic/responder-pool`) — the mobile user's OWN request
 * to become an Authorized Responder (decisions 51, 190). appAuthMiddleware
 * is REQUIRED, never optional: an anonymous witness cannot become a
 * vetted, accountable responder — this is an identified-account-only
 * action, unlike reporting or media upload (32/35).
 *
 * Plane fix, PP1 of plano-panico.md: this route used to be POST
 * '/api/panic/responder-pool' (admin-only router) and read req.user, an
 * admin's tb_user.id — a mobile user has no admin JWT and could never
 * reach it. GET (list) and PUT :id/resolve stay admin-only under /api
 * (responder-pool.routes.ts), unchanged.
 */
const router = Router()

/**
 * @swagger
 * /app-panic/responder-pool:
 *   post:
 *     summary: The caller's own request to join the Authorized Responder pool (decisions 51, 190)
 *     tags: [ResponderPool]
 */
router.post('/', appAuthMiddleware, controller.create)

export default router
