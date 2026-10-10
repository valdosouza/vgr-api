/* eslint-disable no-console */
// Smoke test of the production build (plano-producao.md B1/B2), run by CI
// after `npm run build`: every compiled module must load from dist/ with
// plain Node (no tsx, no tsconfig-paths), and the compiled runner must find
// every migration of src/. Loading the app opens no database connection —
// the pool connects on first query.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist')

require(path.join(dist, 'app.js'))
for (const cli of ['run-migrations.js', 'seed-admin.js']) {
  if (!fs.existsSync(path.join(dist, 'cli', cli))) throw new Error(`dist/cli/${cli} is missing`)
}

const { listMigrationFiles } = require(path.join(dist, 'migrations', 'runner.js'))
const built = listMigrationFiles()
const source = fs.readdirSync(path.join(root, 'src', 'migrations', 'sql')).filter((f) => f.endsWith('.sql'))
if (built.length !== source.length) {
  throw new Error(`dist has ${built.length} migrations, src has ${source.length}`)
}
console.log(`Build OK: app loads with plain Node, ${built.length} migrations shipped`)
process.exit(0)
