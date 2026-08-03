import express from 'express'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import dotenv from 'dotenv'
dotenv.config()

import { authMiddleware } from '@gateway/auth.middleware'
import { rateLimitMiddleware } from '@gateway/rate-limit.middleware'
import apiRouter from '@gateway/router'
import adminLoginRoutes from '@modules/auth/admin-login.routes'
import logger from '@shared/logger/logger'

const app = express()

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.use(express.json({ limit: '2mb' }))

// TEMP DEBUG LOGGING — remove after manual QA session.
app.use((req, _res, next) => {
  logger.info(`--> ${req.method} ${req.path}`, { body: req.method === 'GET' ? undefined : req.body })
  next()
})

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
// (decision 67).
app.use('/auth', adminLoginRoutes)

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
