import express from 'express'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import dotenv from 'dotenv'
dotenv.config()

import { authMiddleware } from '@gateway/auth.middleware'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import { authRateLimitMiddleware, rateLimitMiddleware } from '@gateway/rate-limit.middleware'
import apiRouter from '@gateway/router'
import adminLoginRoutes from '@modules/auth/admin-login.routes'
import appAuthRoutes from '@modules/accounts/account.routes'
import mediaRoutes from '@modules/media/media.routes'
import reportRoutes from '@modules/reports/reports.routes'
import feedRoutes from '@modules/help-matching/help-matching.routes'
import helpOfferRoutes from '@modules/help-offers/help-offers.routes'
import directionSightingRoutes from '@modules/direction-sightings/direction-sightings.routes'
import rewardRoutes from '@modules/reward/reward.routes'
import chatRoutes from '@modules/messaging/chat.routes'
import ratingRoutes, { reportRatingRoutes } from '@modules/ratings/helper-rating.routes'
import responderPoolAppRoutes from '@modules/panic/responder-pool-app.routes'
import panicAlertRoutes from '@modules/panic/panic-alert.routes'
import { allowedOrigins } from '@shared/config/env'
import logger from '@shared/logger/logger'

const app = express()

// Behind the deployment proxy the rate limiter and the audit trail must see
// the real client IP, not the proxy's (decision 115).
app.set('trust proxy', 1)

// Security headers (decision 115). CSP is disabled for now: this API
// serves JSON (+ Swagger outside production); the admin panel is served
// elsewhere — revisit if the API ever serves HTML.
app.use(helmet({ contentSecurityPolicy: false }))

// CORS: explicit origin list (decision 115). '*' only ever happens outside
// production (allowedOrigins enforces it); production without a configured
// origin refuses boot (assertRequiredEnv).
app.use((req, res, next) => {
  const origins = allowedOrigins()
  const requestOrigin = req.headers.origin
  if (origins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (requestOrigin && origins.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.use(express.json({ limit: '2mb' }))

// Request logging is method+path ONLY — never the body (decision 110/SEC-1:
// bodies carry passwords on /auth and, later, reporter data; a debug logger
// once wrote login credentials to the log in clear text — finding A1 in
// AI/docs/plans/plano-seguranca.md).
app.use((req, _res, next) => {
  logger.info(`--> ${req.method} ${req.path}`)
  next()
})

// API docs expose the full attack surface — never public in production
// (finding A3): outside production always on, in production only with an
// explicit SWAGGER_ENABLED=true.
if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: { title: 'VGR API', version: '1.0.0' },
    },
    apis: ['./src/modules/**/*.routes.ts'],
  })
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
  app.get('/docs.json', (_, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerSpec)
  })
}

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health Check
 *     security: []
 *     responses:
 *       200:
 *         description: API is healthy
 */
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// Public — issues the JWT itself, so it must run before authMiddleware
// (decision 67). Rate-limited harder than /api: brute-force target.
app.use('/auth', authRateLimitMiddleware, adminLoginRoutes)

// App plane (decision 119): a separate authentication system with its own
// audience, deliberately NOT under /api — panel tokens are rejected here
// and app tokens are rejected there.
app.use('/app-auth', authRateLimitMiddleware, appAuthRoutes)

// Media (decisions 126-131) — app plane like /app-auth. Anonymous upload
// is deliberate (decisions 32/35); multipart, so the 2mb JSON limit above
// does not apply — multer enforces MEDIA_MAX_BYTES (decision 129).
app.use('/app-media', rateLimitMiddleware, mediaRoutes)

// Helper rating (RT1 — decisions 48/178-189): the owner rates one offer
// of a RESOLVED case. The ratings module's route on the reports module's
// path, mounted from HERE on the full path with mergeParams (the C3
// mechanism of gateway/router.ts) and BEFORE /app-reports: the request
// is rate-limited once, the reports router never sees it, and neither
// module imports the other.
app.use('/app-reports/:reportId/offers/:offerId/rating', rateLimitMiddleware, reportRatingRoutes)

// Reports (decisions 134-142) — the core promise: anonymous submission
// allowed (32), gated by jurisdiction capability, idempotent (137).
app.use('/app-reports', rateLimitMiddleware, reportRoutes)

// Nearby feed (decisions 2/7/21/135) — anonymous, tier-degraded output.
app.use('/app-feed', rateLimitMiddleware, feedRoutes)

// Help offers (decisions 10/20/34/35) — anonymous help is a promise.
app.use('/app-help-offers', rateLimitMiddleware, helpOfferRoutes)

// Direction sighting (DS1 — decisions 200-207): any viewer of an open,
// eligible-category report may log a sighting, anonymous or identified,
// except the report's own reporter (self-dealing, 20's posture applied
// here). Flat route — see direction-sightings.routes.ts's own comment.
app.use('/app-direction-sightings', rateLimitMiddleware, directionSightingRoutes)

// Reward (decisions 1/30/81-102/143-147) — R0 first slice, monetary
// guarantee only. Identified account required (appAuthMiddleware, not
// optional): a monetary reward needs a payer the PSP can bill.
app.use('/app-reward', rateLimitMiddleware, appAuthMiddleware, rewardRoutes)

// Masked chat (decisions 54/169-177) — app plane like /app-reports: the
// anonymous reporter joins by x-client-key, the helper by account
// (optionalAppAuth per route, as reports do); the per-participant message
// rate (177) is enforced in the service, on top of this per-IP limit.
app.use('/app-chat', rateLimitMiddleware, chatRoutes)

// Helper reputation (decisions 184/185) — the helper reads their OWN
// aggregate only; the route itself demands the app token (never
// optional): an anonymous helper has no reputation to read.
app.use('/app-ratings', rateLimitMiddleware, ratingRoutes)

// Authorized Responder pool request (PP1 of plano-panico.md, decisions
// 51/190) — plane fix: an app account requesting to become a responder,
// moved off the admin-only /api plane (see responder-pool.routes.ts's
// header comment for the bug this corrects). Mounted BEFORE the more
// general /app-panic prefix below (specific before general, the
// /app-reports/:id/offers precedent).
app.use('/app-panic/responder-pool', rateLimitMiddleware, responderPoolAppRoutes)

// Panic alert (PP1 — decisions 51, 65, 191-198): a single-shot alert
// (191) to the Authorized Responder pool. Trigger is optionalAppAuth (a
// cold, anonymous witness can fire it, 65/196); the alerts inbox demands
// the app token (only an identified responder has anything to see);
// resolve mirrors trigger's optional ownership (197).
app.use('/app-panic', rateLimitMiddleware, panicAlertRoutes)

// JWT auth on all /api routes (public routes, e.g. listing anonymous
// reports, go BEFORE this line once they exist — scope-refinement will
// define which endpoints allow anonymous access)
app.use('/api', authMiddleware)
app.use('/api', rateLimitMiddleware)
app.use('/api', apiRouter)

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { message: err.message })
  res.status(500).json({ error: 'Internal server error' })
})

export default app
