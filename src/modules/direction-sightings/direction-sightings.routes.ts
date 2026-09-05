import { Router } from 'express'
import { optionalAppAuth } from '@gateway/optional-app-auth.middleware'
import * as controller from '@modules/direction-sightings/direction-sightings.controller'

/**
 * DirectionSighting (DS1 — decisions 200-207), mounted at
 * /app-direction-sightings: app plane, never /api. FLAT top-level route
 * (not nested under /app-reports/:reportId/..., unlike the rating
 * module's mergeParams mount) — a sighting has no sub-resource id the way
 * an offer's rating does (offerId); the body simply carries `reportId`,
 * mirroring help-offers' flat /app-help-offers mount.
 *
 * Plane fix (not a new decision, same class of bug PP1 already found and
 * fixed for the responder-pool's POST): the tactical spec
 * (003-api-tactical-design.md) sketched `POST /api/direction-sightings`
 * before the two-plane split (decision 119) existed — /api is globally
 * gated by authMiddleware requiring an ADMIN JWT (app.ts), so a real
 * mobile witness could never reach it. Corrected here from the start.
 */
const router = Router()

/**
 * @swagger
 * /app-direction-sightings:
 *   post:
 *     summary: Logs a direction sighting on an eligible OPEN report and returns the reconciled estimate synchronously; anonymous allowed except the report's own reporter (decisions 200-207)
 *     security: []
 *     tags: [DirectionSightings]
 */
// optionalAppAuth: decision 200 — ANY viewer of the open report may log a
// sighting, anonymous or identified; only the report's own reporter is
// excluded (self-dealing, enforced in the service).
router.post('/', optionalAppAuth, controller.submit)

export default router
