import express from 'express'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import dotenv from 'dotenv'
dotenv.config()

import { authMiddleware } from '@gateway/auth.middleware'
import { authRateLimitMiddleware, rateLimitMiddleware } from '@gateway/rate-limit.middleware'
import apiRouter from '@gateway/router'
import adminLoginRoutes from '@modules/auth/admin-login.routes'
import appAuthRoutes from '@modules/accounts/account.routes'
import mediaRoutes from '@modules/media/media.routes'
import reportRoutes from '@modules/reports/reports.routes'
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

// Reports (decisions 134-142) — the core promise: anonymous submission
// allowed (32), gated by jurisdiction capability, idempotent (137).
app.use('/app-reports', rateLimitMiddleware, reportRoutes)

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
