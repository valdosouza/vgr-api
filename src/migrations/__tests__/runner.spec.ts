import fs from 'fs'
import os from 'os'
import path from 'path'
import { listMigrationFiles } from '../runner'

jest.mock('@shared/db/connection', () => ({ __esModule: true, default: {} }))

/** plano-producao.md B2: the production build once shipped without the
 *  `.sql` files, and the runner reported success over an empty database. */
describe('listMigrationFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgr-migrations-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('lists the .sql files in order, ignoring anything else', () => {
    fs.writeFileSync(path.join(dir, '002_b.sql'), '')
    fs.writeFileSync(path.join(dir, '001_a.sql'), '')
    fs.writeFileSync(path.join(dir, 'README.md'), '')

    expect(listMigrationFiles(dir)).toEqual(['001_a.sql', '002_b.sql'])
  })

  it('refuses a folder with no migrations instead of reporting success', () => {
    expect(() => listMigrationFiles(dir)).toThrow(/No migration files found/)
  })

  it('refuses a missing folder', () => {
    expect(() => listMigrationFiles(path.join(dir, 'absent'))).toThrow(/No migration files found/)
  })

  it('finds the real migrations next to the runner', () => {
    expect(listMigrationFiles()).toContain('004_accountability_log.sql')
  })
})
