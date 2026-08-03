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

  it('the migration-022 seed contains exactly the TS catalog keys', () => {
    const migration = fs.readFileSync(
      path.join(SRC_DIR, 'migrations', 'sql', '022_legal_gate.sql'),
      'utf8'
    )
    const seeded = [...migration.matchAll(/^\s*\('([a-z][a-z0-9_.]+)',\s*'/gm)]
      .map((match) => match[1])
      .filter((key) => key.includes('.'))

    expect(seeded.sort()).toEqual([...catalogValues].sort())
  })

  it('every capability key follows the domain.action[.qualifier] convention', () => {
    for (const key of catalogValues) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/)
    }
  })
})
