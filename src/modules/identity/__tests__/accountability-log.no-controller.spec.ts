import fs from 'fs'
import path from 'path'

describe('accountability-log — structural guarantee', () => {
  it('never exposes a controller, DTO, or routes file for this module (never serializable through any DTO used by a controller)', () => {
    const moduleDir = path.join(__dirname, '..')
    const files = fs.readdirSync(moduleDir)

    expect(files).not.toEqual(expect.arrayContaining([expect.stringMatching(/^accountability-log\.(controller|dto|routes)\.ts$/)]))
  })
})
