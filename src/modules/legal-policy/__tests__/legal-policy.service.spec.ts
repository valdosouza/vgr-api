import * as repository from '@modules/legal-policy/legal-policy.repository'
import * as gate from '@shared/legal/legal-gate'
import * as service from '@modules/legal-policy/legal-policy.service'
import {
  JurisdictionAdminRow,
  LegalRuleProposal,
  LegalRuleRow,
} from '@modules/legal-policy/legal-policy.interface'
import { Capabilities } from '@shared/legal/capabilities'

jest.mock('@modules/legal-policy/legal-policy.repository')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedGate = gate as jest.Mocked<typeof gate>

function proposal(overrides: Partial<LegalRuleProposal> = {}): LegalRuleProposal {
  return {
    capability: Capabilities.REPORT_ANONYMOUS,
    jurisdictionCode: 'BR',
    status: 'allowed',
    reason: null,
    legalBasis: 'LGPD art. 7',
    reviewState: 'ai_assessed',
    expiresInDays: 180,
    ...overrides,
  }
}

function ruleRow(overrides: Partial<LegalRuleRow> = {}): LegalRuleRow {
  return {
    id: 10,
    capability: Capabilities.REPORT_ANONYMOUS,
    jurisdictionCode: 'BR',
    version: 1,
    status: 'allowed',
    reason: null,
    legalBasis: null,
    reviewState: 'ai_assessed',
    ruleState: 'proposed',
    effectiveFrom: null,
    expiresAt: new Date(Date.now() + 180 * 86_400_000),
    proposedBy: 1,
    approvedBy: null,
    createdAt: new Date(),
    decidedAt: null,
    ...overrides,
  }
}

function jurisdictionRow(overrides: Partial<JurisdictionAdminRow> = {}): JurisdictionAdminRow {
  return {
    code: 'BR',
    name: 'Brazil',
    operationalState: 'live',
    isSandbox: false,
    pendingState: null,
    pendingBy: null,
    ...overrides,
  }
}

describe('legal-policy.service — rules (decision 107)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('rejects a proposal for a capability outside the TS catalog (decision 103)', async () => {
    await expect(
      service.proposeRule(proposal({ capability: 'reward.moentary' }), 1)
    ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    expect(mockedRepository.insertProposal).not.toHaveBeenCalled()
  })

  it('rejects a second open proposal for the same capability x jurisdiction', async () => {
    mockedRepository.findJurisdictionByCode.mockResolvedValue(jurisdictionRow())
    mockedRepository.findOpenProposal.mockResolvedValue(ruleRow())

    await expect(service.proposeRule(proposal(), 1)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE',
    })
  })

  it('persists a valid proposal as proposed — never enforced before approval', async () => {
    mockedRepository.findJurisdictionByCode.mockResolvedValue(jurisdictionRow())
    mockedRepository.findOpenProposal.mockResolvedValue(null)
    mockedRepository.insertProposal.mockResolvedValue(10)
    mockedRepository.findRuleById.mockResolvedValue(ruleRow())

    const created = await service.proposeRule(proposal(), 1)

    expect(created.ruleState).toBe('proposed')
    expect(mockedGate.invalidateLegalGateCache).not.toHaveBeenCalled()
  })

  it('refuses approval by the proposer — one proposes, a DIFFERENT one approves', async () => {
    mockedRepository.findRuleById.mockResolvedValue(ruleRow({ proposedBy: 7 }))

    await expect(service.approveRule(10, 7)).rejects.toMatchObject({
      statusCode: 409,
      code: 'BUSINESS_RULE',
    })
    expect(mockedRepository.activateRule).not.toHaveBeenCalled()
  })

  it('activates on approval by a distinct user and invalidates the gate cache', async () => {
    const row = ruleRow({ proposedBy: 7 })
    mockedRepository.findRuleById
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, ruleState: 'active', approvedBy: 9 })

    const approved = await service.approveRule(10, 9)

    expect(mockedRepository.activateRule).toHaveBeenCalledWith(10, row, 9)
    expect(mockedGate.invalidateLegalGateCache).toHaveBeenCalled()
    expect(approved.ruleState).toBe('active')
  })

  it('refuses to approve a rule that is not awaiting approval', async () => {
    mockedRepository.findRuleById.mockResolvedValue(ruleRow({ ruleState: 'active' }))

    await expect(service.approveRule(10, 9)).rejects.toMatchObject({
      statusCode: 409,
      code: 'BUSINESS_RULE',
    })
  })

  it('blocks allowing reward.monetary while reward.mediation lacks an active allowed rule (decision 98)', async () => {
    mockedRepository.findRuleById.mockResolvedValue(
      ruleRow({ capability: Capabilities.REWARD_MONETARY, proposedBy: 7 })
    )
    mockedRepository.findActiveAllowedRule.mockResolvedValue(null)

    await expect(service.approveRule(10, 9)).rejects.toMatchObject({
      statusCode: 422,
      code: 'BUSINESS_RULE',
    })
    expect(mockedRepository.findActiveAllowedRule).toHaveBeenCalledWith(
      Capabilities.REWARD_MEDIATION,
      'BR'
    )
  })

  it('blocks blocking reward.mediation while reward.monetary is still allowed (decision 98, reverse direction)', async () => {
    mockedRepository.findRuleById.mockResolvedValue(
      ruleRow({
        capability: Capabilities.REWARD_MEDIATION,
        status: 'blocked',
        reason: 'self_preservation',
        proposedBy: 7,
      })
    )
    mockedRepository.findActiveAllowedRule.mockResolvedValue(
      ruleRow({ capability: Capabilities.REWARD_MONETARY, ruleState: 'active' })
    )

    await expect(service.approveRule(10, 9)).rejects.toMatchObject({
      statusCode: 422,
      code: 'BUSINESS_RULE',
    })
  })
})

describe('legal-policy.service — kill switch (decision 107)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('applies a tightening (live -> suspended) immediately, one person', async () => {
    mockedRepository.findJurisdictionByCode
      .mockResolvedValueOnce(jurisdictionRow())
      .mockResolvedValueOnce(jurisdictionRow({ operationalState: 'suspended' }))

    const updated = await service.requestOperationalState('BR', 'suspended', 7)

    expect(mockedRepository.applyOperationalState).toHaveBeenCalledWith('BR', 'suspended')
    expect(mockedRepository.setPendingState).not.toHaveBeenCalled()
    expect(updated.operationalState).toBe('suspended')
  })

  it('records a loosening (suspended -> live) as pending — never applies it directly', async () => {
    mockedRepository.findJurisdictionByCode
      .mockResolvedValueOnce(jurisdictionRow({ operationalState: 'suspended' }))
      .mockResolvedValueOnce(
        jurisdictionRow({ operationalState: 'suspended', pendingState: 'live', pendingBy: 7 })
      )

    const updated = await service.requestOperationalState('BR', 'live', 7)

    expect(mockedRepository.setPendingState).toHaveBeenCalledWith('BR', 'live', 7)
    expect(mockedRepository.applyOperationalState).not.toHaveBeenCalled()
    expect(updated.pendingState).toBe('live')
  })

  it('refuses confirmation by the same person who proposed the loosening', async () => {
    mockedRepository.findJurisdictionByCode.mockResolvedValue(
      jurisdictionRow({ operationalState: 'suspended', pendingState: 'live', pendingBy: 7 })
    )

    await expect(service.confirmOperationalState('BR', 7)).rejects.toMatchObject({
      statusCode: 409,
      code: 'BUSINESS_RULE',
    })
  })

  it('applies the pending state when a distinct approver confirms', async () => {
    mockedRepository.findJurisdictionByCode
      .mockResolvedValueOnce(
        jurisdictionRow({ operationalState: 'suspended', pendingState: 'live', pendingBy: 7 })
      )
      .mockResolvedValueOnce(jurisdictionRow({ operationalState: 'live' }))

    const updated = await service.confirmOperationalState('BR', 9)

    expect(mockedRepository.applyOperationalState).toHaveBeenCalledWith('BR', 'live')
    expect(updated.operationalState).toBe('live')
  })

  it('refuses to confirm when nothing is pending', async () => {
    mockedRepository.findJurisdictionByCode.mockResolvedValue(jurisdictionRow())

    await expect(service.confirmOperationalState('BR', 9)).rejects.toMatchObject({
      statusCode: 409,
      code: 'BUSINESS_RULE',
    })
  })
})

/** PS0 (decision 220): the three lists compose the two shapes. */
describe('legal-policy.service — list paging (decision 220)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('listJurisdictions without page returns the plain array and never counts', async () => {
    mockedRepository.listJurisdictions.mockResolvedValue([jurisdictionRow()])

    await expect(service.listJurisdictions({ pageSize: 20 })).resolves.toEqual([jurisdictionRow()])

    expect(mockedRepository.listJurisdictions).toHaveBeenCalledWith(undefined, undefined)
    expect(mockedRepository.countJurisdictions).not.toHaveBeenCalled()
  })

  it('listJurisdictions with page passes the window and returns the paged shape', async () => {
    mockedRepository.countJurisdictions.mockResolvedValue(3)
    mockedRepository.listJurisdictions.mockResolvedValue([jurisdictionRow()])

    await expect(service.listJurisdictions({ page: 2, pageSize: 2, filter: 'br' })).resolves.toEqual({
      items: [jurisdictionRow()],
      page: 2,
      pageSize: 2,
      total: 3,
    })

    expect(mockedRepository.countJurisdictions).toHaveBeenCalledWith('br')
    expect(mockedRepository.listJurisdictions).toHaveBeenCalledWith('br', { limit: 2, offset: 2 })
  })

  it('listCapabilities still 404s an unknown jurisdiction before any list or count', async () => {
    mockedRepository.findJurisdictionByCode.mockResolvedValue(null)

    await expect(service.listCapabilities('XX', { page: 1, pageSize: 20 })).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(mockedRepository.listCapabilityOverview).not.toHaveBeenCalled()
    expect(mockedRepository.countCapabilities).not.toHaveBeenCalled()
  })

  it('listCapabilities with page passes jurisdiction, filter and window; total counts the catalog', async () => {
    mockedRepository.findJurisdictionByCode.mockResolvedValue(jurisdictionRow())
    mockedRepository.countCapabilities.mockResolvedValue(14)
    mockedRepository.listCapabilityOverview.mockResolvedValue([])

    await expect(
      service.listCapabilities('BR', { page: 2, pageSize: 10, filter: 'reward' })
    ).resolves.toEqual({ items: [], page: 2, pageSize: 10, total: 14 })

    expect(mockedRepository.countCapabilities).toHaveBeenCalledWith('reward')
    expect(mockedRepository.listCapabilityOverview).toHaveBeenCalledWith('BR', 'reward', {
      limit: 10,
      offset: 10,
    })
  })

  it('listRules without page keeps the exact filters and the plain array', async () => {
    const rule = ruleRow()
    mockedRepository.listRules.mockResolvedValue([rule])

    await expect(
      service.listRules({ pageSize: 20, capability: 'chat.masked', jurisdiction: 'BR' })
    ).resolves.toEqual([rule])

    expect(mockedRepository.listRules).toHaveBeenCalledWith(
      { capability: 'chat.masked', jurisdictionCode: 'BR', filter: undefined },
      undefined
    )
    expect(mockedRepository.countRules).not.toHaveBeenCalled()
  })

  it('listRules with page passes the window and returns the paged shape', async () => {
    const rule = ruleRow()
    mockedRepository.countRules.mockResolvedValue(21)
    mockedRepository.listRules.mockResolvedValue([rule])

    await expect(service.listRules({ page: 3, pageSize: 10, filter: 'LGPD' })).resolves.toEqual({
      items: [rule],
      page: 3,
      pageSize: 10,
      total: 21,
    })

    const filters = { capability: undefined, jurisdictionCode: undefined, filter: 'LGPD' }
    expect(mockedRepository.countRules).toHaveBeenCalledWith(filters)
    expect(mockedRepository.listRules).toHaveBeenCalledWith(filters, { limit: 10, offset: 20 })
  })
})
