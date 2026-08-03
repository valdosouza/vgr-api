import app from './app'
import logger from '@shared/logger/logger'
import { runMigrations } from './migrations/runner'
import { assertRequiredEnv } from '@shared/config/env'

const PORT = process.env.PORT ?? 3000

async function bootstrap() {
  try {
    // Fail fast on missing security-critical env (finding A2) — a
    // misconfigured production install must not come up half-secure.
    assertRequiredEnv()
    logger.info('Starting migrations...')
    await runMigrations()
    logger.info('Migrations completed. Starting server...')

    app.listen(PORT, () => {
      logger.info(`VGR API running on port ${PORT}`)
    })
  } catch (err) {
    logger.error('Startup failed', { err })
    process.exit(1)
  }
}

bootstrap()
