import * as fs from 'fs'
import * as path from 'path'
import { Capabilities, PENDING_WIRING } from '@shared/legal/capabilities'

/**
 * Guard 2 of decision 103: a cataloged capability with no caller is debt,
 * not protection — and it must never be SILENT debt. Every catalog entry
 * is either actually consumed (requireCapability/assertCapability call
 * sites outside shared/legal) or explicitly declared in PENDING_WIRING.
 * The two sets must exactly partition the catalog.
 *
 * Also asserts the migration-022 seed mirrors the TS catalog — the DB copy
 * backs the admin UI and the rule FK, and drift between the two would let
 * an admin write rules the gate never reads.
 */

const SRC_DIR = path.resolve(__dirname, '../../..')

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') return []
      return listSourceFiles(full)
    }
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

describe('capability catalog (decision 103)', () => {
  const catalogValues = Object.values(Capabilities) as string[]

  it('every capability is either wired to a caller or explicitly pending — never neither, never both', () => {
    const sharedLegalDir = path.join(SRC_DIR, 'shared', 'legal')
    const enforcementFiles = listSourceFiles(SRC_DIR).filter(
      (file) => !file.startsWith(sharedLegalDir)
    )

    const wired = new Set<string>()
    for (const file of enforcementFiles) {
      const content = fs.readFileSync(file, 'utf8')
      if (!content.includes('requireCapability') && !content.includes('assertCapability')) {
        continue
      }
      for (const [constant, key] of Object.entries(Capabilities)) {
        if (content.includes(`Capabilities.${constant}`) || content.includes(`'${key}'`)) {
          wired.add(key)
        }
      }
    }

    for (const key of catalogValues) {
      const isPending = PENDING_WIRING.has(key as any)
      const isWired = wired.has(key)
      // Wired AND still listed as pending -> the wiring task forgot to
      // remove the entry; neither -> silent dead entry. Both fail.
      expect({ key, isPending, isWired, valid: isPending !== isWired }).toEqual(
        expect.objectContaining({ valid: true })
      )
    }
  })

  it('the tb_legal_capability seeds across migrations contain exactly the TS catalog keys', () => {
    // Capabilities born after migration 022 (e.g. report.media in 033,
    // decision 138) are seeded by their own migration — the mirror guard
    // must therefore read EVERY seed, not just the founding one.
    const sqlDir = path.join(SRC_DIR, 'migrations', 'sql')
    const seeded = fs
      .readdirSync(sqlDir)
      .filter((file) => file.endsWith('.sql'))
      .flatMap((file) => {
        const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8')
        return [...sql.matchAll(/INSERT INTO tb_legal_capability[\s\S]*?;/g)].flatMap((block) =>
          [...block[0].matchAll(/\('([a-z][a-z0-9_.]+)',\s*'/g)].map((match) => match[1])
        )
      })
      .filter((key) => key.includes('.'))

    expect(seeded.sort()).toEqual([...catalogValues].sort())
  })

  it('every capability key follows the domain.action[.qualifier] convention', () => {
    for (const key of catalogValues) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/)
    }
  })
})
