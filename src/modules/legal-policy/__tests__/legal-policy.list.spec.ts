import pool from '@shared/db/connection'
import * as repository from '@modules/legal-policy/legal-policy.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** SQL contracts of the three Legal Gate admin lists under PS0 (decision 220). */
describe('legal-policy.repository — list paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('jurisdictions', () => {
    it('without a window keeps the unpaged SELECT (legacy)', async () => {
      mockedPool.query.mockResolvedValue([[]])

      await repository.listJurisdictions(undefined, undefined)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toMatch(/FROM tb_jurisdiction WHERE deleted = 'N' ORDER BY code$/)
      expect(params).toEqual([])
    })

    it('with filter and window: LIKE on code OR name, LIMIT ? OFFSET ? parameterized', async () => {
      mockedPool.query.mockResolvedValue([[]])

      await repository.listJurisdictions('bra', { limit: 10, offset: 10 })

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain("WHERE deleted = 'N' AND (code LIKE ? OR name LIKE ?)")
      expect(flat(sql)).toMatch(/LIMIT \? OFFSET \?$/)
      expect(params).toEqual(['%bra%', '%bra%', 10, 10])
    })

    it('counts the filtered jurisdictions', async () => {
      mockedPool.query.mockResolvedValue([[{ total: 1 }]])

      await expect(repository.countJurisdictions('bra')).resolves.toBe(1)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toBe(
        "SELECT COUNT(*) AS total FROM tb_jurisdiction WHERE deleted = 'N' AND (code LIKE ? OR name LIKE ?)"
      )
      expect(params).toEqual(['%bra%', '%bra%'])
    })
  })

  describe('capabilities overview', () => {
    it('without a window keeps the unpaged SELECT with the jurisdiction as the only param (legacy)', async () => {
      mockedPool.query.mockResolvedValue([[]])

      await repository.listCapabilityOverview('BR', undefined, undefined)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toMatch(/WHERE c\.deleted = 'N' ORDER BY c\.module, c\.capability$/)
      expect(params).toEqual(['BR'])
    })

    it('with filter and window: LIKE on capability OR description, LIMIT ? OFFSET ?', async () => {
      mockedPool.query.mockResolvedValue([[]])

      await repository.listCapabilityOverview('BR', 'reward', { limit: 10, offset: 10 })

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain("WHERE c.deleted = 'N' AND (c.capability LIKE ? OR c.description LIKE ?)")
      expect(flat(sql)).toMatch(/LIMIT \? OFFSET \?$/)
      expect(params).toEqual(['BR', '%reward%', '%reward%', 10, 10])
    })

    it('counts the filtered catalog rows — the catalog, not the rules', async () => {
      mockedPool.query.mockResolvedValue([[{ total: 4 }]])

      await expect(repository.countCapabilities('reward')).resolves.toBe(4)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toBe(
        "SELECT COUNT(*) AS total FROM tb_legal_capability c WHERE c.deleted = 'N' AND (c.capability LIKE ? OR c.description LIKE ?)"
      )
      expect(params).toEqual(['%reward%', '%reward%'])
    })
  })

  describe('rules', () => {
    it('without a window keeps the exact filters and legacy order', async () => {
      mockedPool.query.mockResolvedValue([[]])

      await repository.listRules({ capability: 'reward.monetary', jurisdictionCode: 'BR' }, undefined)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain("WHERE deleted = 'N' AND capability = ? AND jurisdiction_code = ?")
      expect(flat(sql)).toMatch(/ORDER BY capability, jurisdiction_code, version DESC$/)
      expect(params).toEqual(['reward.monetary', 'BR'])
    })

    it('with text filter and window: LIKE on capability, jurisdiction_code or legal_basis, LIMIT ? OFFSET ?', async () => {
      mockedPool.query.mockResolvedValue([[]])

      await repository.listRules({ filter: 'LGPD' }, { limit: 10, offset: 20 })

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain(
        "WHERE deleted = 'N' AND (capability LIKE ? OR jurisdiction_code LIKE ? OR legal_basis LIKE ?)"
      )
      expect(flat(sql)).toMatch(/LIMIT \? OFFSET \?$/)
      expect(params).toEqual(['%LGPD%', '%LGPD%', '%LGPD%', 10, 20])
    })

    it('counts with the same clauses as the list', async () => {
      mockedPool.query.mockResolvedValue([[{ total: 9 }]])

      await expect(repository.countRules({ capability: 'chat.masked', filter: 'x' })).resolves.toBe(9)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toBe(
        "SELECT COUNT(*) AS total FROM tb_legal_rule WHERE deleted = 'N' AND capability = ? AND (capability LIKE ? OR jurisdiction_code LIKE ? OR legal_basis LIKE ?)"
      )
      expect(params).toEqual(['chat.masked', '%x%', '%x%', '%x%'])
    })
  })
})
