import { randomBytes } from 'crypto'
import pool from '@shared/db/connection'
import { appendAccountabilityLogEntry } from '@modules/identity/accountability-log.repository'
import { decryptEnvelope, isEnvelope } from '@shared/crypto/envelope'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

describe('accountability-log.repository', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    process.env.LEGAL_KEK = randomBytes(32).toString('base64')
  })

  afterAll(() => {
    delete process.env.LEGAL_KEK
  })

  it('appends an entry with IP and metadata envelope-encrypted at write time (decisions 44/111)', async () => {
    mockedPool.query.mockResolvedValue([{}, undefined] as any)

    await appendAccountabilityLogEntry('report_submitted', '203.0.113.7', { reportId: 1 })

    const [sql, params] = mockedPool.query.mock.calls[0] as unknown as [string, string[]]
    expect(sql).toContain('INSERT INTO tb_accountability_log')
    expect(params[0]).toBe('report_submitted')
    // Never clear text on the wire to the DB — asset #1 of decision 110.
    expect(params[1]).not.toContain('203.0.113.7')
    expect(isEnvelope(params[1])).toBe(true)
    expect(decryptEnvelope(params[1])).toBe('203.0.113.7')
    expect(decryptEnvelope(params[2])).toBe(JSON.stringify({ reportId: 1 }))
  })

  it('accepts a null metadata payload — null stays null, never an encrypted "null"', async () => {
    mockedPool.query.mockResolvedValue([{}, undefined] as any)

    await appendAccountabilityLogEntry('help_offer_submitted', '203.0.113.8', null)

    const [, params] = mockedPool.query.mock.calls[0] as unknown as [string, (string | null)[]]
    expect(isEnvelope(params[1] as string)).toBe(true)
    expect(params[2]).toBeNull()
  })
})
