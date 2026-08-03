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
