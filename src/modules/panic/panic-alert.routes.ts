import { Router } from 'express'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import { optionalAppAuth } from '@gateway/optional-app-auth.middleware'
import * as controller from '@modules/panic/panic-alert.controller'

/**
 * PanicAlert (PP1 — decisions 51, 65, 191-198), mounted at /app-panic:
 * app plane, never /api. A single-shot alert (191) to the Authorized
 * Responder pool (51) — no configuration required, cold trigger (65).
 */
const router = Router()

/**
 * @swagger
 * /app-panic/alert:
 *   post:
 *     summary: Triggers a single-shot panic alert to the Authorized Responder pool; idempotent by clientKey, cooldown for identified callers (decisions 51/65/191/196/198)
 *     security: []
 *     tags: [Panic]
 */
// optionalAppAuth: a cold, anonymous witness triggers exactly like an
// anonymous reporter files a report (32/35) — decision 65's promise that
// the click is never blocked waiting on configuration or an account.
router.post('/alert', optionalAppAuth, controller.trigger)

/**
 * @swagger
 * /app-panic/alerts:
 *   get:
 *     summary: The caller's inbox of alerts where they are a snapshotted responder — cursor paging, degraded distance (decisions 51/192/195)
 *     tags: [Panic]
 */
// appAuthMiddleware REQUIRED: only an identified, currently-approved
// responder was ever a possible recipient (an anonymous witness cannot
// be one, decision 51/190).
router.get('/alerts', appAuthMiddleware, controller.list)

/**
 * @swagger
 * /app-panic/alerts/{id}/resolve:
 *   post:
 *     summary: Resolves the caller's OWN alert — only the triggerer may resolve, never a responder or admin (decision 197)
 *     security: []
 *     tags: [Panic]
 */
router.post('/alerts/:id/resolve', optionalAppAuth, controller.resolve)

export default router
