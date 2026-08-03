import cron from 'node-cron'
import { runMediaExpiry } from '@modules/media/media-expiry.job'
import { purgeExpiredReports } from '@modules/reports/reports.service'
import { withJobLock } from '@shared/db/job-lock'
import logger from '@shared/logger/logger'

/**
 * In-process scheduled work (decision 90) — symmetric to router.ts: every
 * job is registered here, never inside a module. Guards from the decision:
 *  - never under test (NODE_ENV=test skips registration entirely);
 *  - never during migrations (scripts/run-migrations.ts is a separate
 *    process that does not import this file; server.ts only starts the
 *    scheduler after migrations complete);
 *  - single instance: each run takes a MySQL lock (withJobLock), so with
 *    N API processes a job still executes in exactly one.
 */
let started = false

async function run(name: string, job: () => Promise<unknown>): Promise<void> {
  try {
    const result = await withJobLock(`vgr:${name}`, job)
    if (result === null) {
      logger.info(`Job ${name} skipped — another instance holds the lock`)
    }
  } catch (err) {
    logger.error(`Job ${name} failed`, { err })
  }
}

export function startScheduler(): void {
  if (process.env.NODE_ENV === 'test' || started) return
  started = true

  // Retention (decision 131): hourly is plenty for a 90-day window and
  // keeps the shredding delay after expiry under an hour.
  cron.schedule('0 * * * *', () => void run('media-expiry', runMediaExpiry))

  // Report purge (decisions 25/131) — same clock, its own lock.
  cron.schedule('30 * * * *', () => void run('report-purge', purgeExpiredReports))

  logger.info('Scheduler started (media-expiry, report-purge hourly)')
}
