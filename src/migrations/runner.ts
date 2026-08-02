import fs from 'fs'
import path from 'path'
import pool from '@shared/db/connection'
import logger from '@shared/logger/logger'

const SQL_DIR = path.join(__dirname, 'sql')

/**
 * Single-schema migration runner (VGR hasn't decided on per-institution
 * multi-tenancy yet — if it does, mirror `runMigrationsForAllInstitutions`
 * from setes-api, iterating one schema per tenant).
 *
 * `NNN_description.sql` files in `src/migrations/sql/`, applied in order,
 * tracked in the `_migrations` table.
 */
export async function runMigrations(): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version     INT PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const [rows] = await conn.query<any[]>('SELECT version FROM _migrations')
    const applied = new Set(rows.map((r) => r.version))

    const files = fs.existsSync(SQL_DIR)
      ? fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')).sort()
      : []

    for (const file of files) {
      const version = Number(file.split('_')[0])
      if (applied.has(version)) continue

      const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf-8')
      const statements = splitStatements(sql)

      logger.info(`Applying migration ${file}`)
      for (const statement of statements) {
        if (statement.trim()) await conn.query(statement)
      }

      await conn.query('INSERT INTO _migrations (version, name) VALUES (?, ?)', [version, file])
    }
  } finally {
    conn.release()
  }
}

/** Splits a SQL file into statements by `;`, respecting `BEGIN...END;` trigger/procedure blocks. */
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let depth = 0
  let current = ''

  for (const line of sql.split('\n')) {
    const upper = line.trim().toUpperCase()
    if (upper.startsWith('BEGIN')) depth++
    if (upper.startsWith('END')) depth = Math.max(0, depth - 1)

    current += line + '\n'
    if (line.trim().endsWith(';') && depth === 0) {
      statements.push(current)
      current = ''
    }
  }
  if (current.trim()) statements.push(current)
  return statements
}
