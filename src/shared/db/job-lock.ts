import pool from '@shared/db/connection'

/**
 * Single-instance lock for scheduled jobs (decision 90): with more than
 * one API process running, a job fires everywhere but executes in exactly
 * one. MySQL GET_LOCK is connection-scoped, so acquire and release MUST
 * happen on the same dedicated connection — never through pool.query.
 *
 * Returns null when another instance holds the lock (job skipped there).
 */
export async function withJobLock<T>(
  name: string,
  job: () => Promise<T>
): Promise<T | null> {
  const connection = await pool.getConnection()
  try {
    const [rows] = await connection.query<any[]>('SELECT GET_LOCK(?, 0) AS locked', [name])
    if (rows[0]?.locked !== 1) return null
    try {
      return await job()
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [name])
    }
  } finally {
    connection.release()
  }
}
