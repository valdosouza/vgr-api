/* eslint-disable no-console */
// Post-build step: `tsc` compiles only TypeScript, so the migration SQL is
// copied next to the compiled runner (dist/migrations/sql), where it reads
// it from (plano-producao.md B2). Plain Node, no dependencies.
const fs = require('fs')
const path = require('path')

const from = path.join(__dirname, '..', 'src', 'migrations', 'sql')
const to = path.join(__dirname, '..', 'dist', 'migrations', 'sql')

fs.rmSync(to, { recursive: true, force: true })
fs.cpSync(from, to, { recursive: true })
const count = fs.readdirSync(to).filter((f) => f.endsWith('.sql')).length
console.log(`Copied ${count} migration files to dist/migrations/sql`)
