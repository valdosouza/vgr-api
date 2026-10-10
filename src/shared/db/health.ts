import pool from '@shared/db/connection'

/**
 * Whether the database answers within `timeoutMs` (decision 245). The
 * external check calls /health every minute; a process that serves but
 * cannot reach MariaDB is down for every user, so /health must say so.
 * A pool waiting on an unreachable host takes ~10 s to fail on its own —
 * the timeout keeps the check fast and the answer honest.
 */
export async function pingDatabase(timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const query = pool.query('SELECT 1').then(
    () => true,
    () => false
  )
  try {
    return await Promise.race([query, timeout])
  } finally {
    clearTimeout(timer)
  }
}
