import app from './app'
import logger from '@shared/logger/logger'
import { runMigrations } from './migrations/runner'

const PORT = process.env.PORT ?? 3000

async function bootstrap() {
  try {
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
