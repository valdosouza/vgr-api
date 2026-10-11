import { runMigrations } from '../migrations/runner'
import logger from '@shared/logger/logger'

runMigrations()
  .then(() => {
    logger.info('Migrations completed.')
    process.exit(0)
  })
  .catch((err) => {
    logger.error('Failed to run migrations', { err })
    process.exit(1)
  })
