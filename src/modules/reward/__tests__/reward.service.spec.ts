import * as repository from '@modules/reward/reward.repository'
import * as service from '@modules/reward/reward.service'
import { paymentRail } from '@shared/payment/payment-rail'
import { assertCapability } from '@shared/legal/legal-gate'

jest.mock('@modules/reward/reward.repository')
jest.mock('@shared/payment/payment-rail')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAssertCapability = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedPaymentRail = paymentRail as jest.MockedFunction<typeof paymentRail>

const OFFER_OPEN = {
  id: 1,
  reportId: 7,
  amountCents: 15000,
  guaranteeMode: 'none' as const,
  status: 'open' as const,
  railChargeId: null,
  noReturnNoticeVersion: '',
  criteriaVersion: '',
  createdAt: new Date(),
  resolvedAt: null,
}

const OFFER_RESERVED = {
  ...OFFER_OPEN,
  guaranteeMode: 'reserved' as const,
  status: 'reserved' as const,
  railChargeId: 'pay_1',
  criteriaVersion: 'crit-1',
}

const CRITERIA = {
  id: 1,
  version: 'crit-1',
  body: 'The published rules of the game.',
  publishedBy: 1,
  publishedAt: new Date(),
}

const RESOLUTION_PROPOSED = {
  id: 11,
  rewardOfferId: 1,
  outcome: 'fulfilled' as const,
  reason: 'Condition met',
  criteriaVersion: 'crit-1',
  proposedBy: 3,
  proposedAt: new Date(),
  approvedBy: null,
  approvedAt: null,
  windowEndsAt: null,
  executedAt: null,
  status: 'proposed' as const,
}

const RESOLUTION_APPROVED = {
  ...RESOLUTION_PROPOSED,
  approvedBy: 4,
  approvedAt: new Date(),
  windowEndsAt: new Date(Date.now() - 1000),
  status: 'approved' as const,
}

function railMock() {
  return {
    onboardRecipient: jest.fn(),
    reserve: jest.fn(),
    capture: jest.fn(),
    cancel: jest.fn(),
    getRetentionState: jest.fn(),
  }
}

describe('reward.service (decisions 1/30/81-102/143-147)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedAssertCapability.mockResolvedValue({} as any)
  })

  describe('offerReward', () => {
    it('lets the reporter offer a reward on their own open report', async () => {
      mockedRepository.findReportForOffer.mockResolvedValue({
        id: 7,
        reporterAccountId: 42,
        status: 'open',
      })
      mockedRepository.findOfferByReport.mockResolvedValue(null)
      mockedRepository.insertOffer.mockResolvedValue(1)

      const result = await service.offerReward(
        { reportId: 7, amountCents: 15000 },
        { accountId: 42 }
      )

      expect(result).toEqual({ offerId: 1 })
      expect(mockedAssertCapability).toHaveBeenCalledTimes(2)
    })

    it('rejects a reward offered by someone other than the reporter', async () => {
      mockedRepository.findReportForOffer.mockResolvedValue({
        id: 7,
        reporterAccountId: 42,
        status: 'open',
      })

      await expect(
        service.offerReward({ reportId: 7, amountCents: 15000 }, { accountId: 99 })
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(mockedRepository.insertOffer).not.toHaveBeenCalled()
    })

    it('rejects a second reward offer on the same report', async () => {
      mockedRepository.findReportForOffer.mockResolvedValue({
        id: 7,
        reporterAccountId: 42,
        status: 'open',
      })
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_OPEN)

      await expect(
        service.offerReward({ reportId: 7, amountCents: 15000 }, { accountId: 42 })
      ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE' })
    })

    it('404s on a missing report', async () => {
      mockedRepository.findReportForOffer.mockResolvedValue(null)

      await expect(
        service.offerReward({ reportId: 7, amountCents: 15000 }, { accountId: 42 })
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('reserveGuarantee (decision 147 â€” recipients fixed here)', () => {
    const RESERVE_INPUT = {
      reportId: 7,
      noReturnNoticeVersion: 'v1',
      payerTaxId: '11111111111',
      payerName: 'Reporter One',
      recipients: [{ helpOfferId: 5, amountCents: 15000 }],
    }

    beforeEach(() => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_OPEN)
      mockedRepository.findActiveCriteria.mockResolvedValue(CRITERIA)
      mockedRepository.findHelpOffersForRecipients.mockResolvedValue([
        { id: 5, helperAccountId: 8 },
      ])
      mockedRepository.findRecipientProfile.mockResolvedValue({ railRecipientId: 'wallet_1' })
      const rail = railMock()
      rail.reserve.mockResolvedValue({ railChargeId: 'pay_1' })
      mockedPaymentRail.mockReturnValue(rail as any)
    })

    it('reserves against the fixed recipient set, stamping the active criteria version', async () => {
      await service.reserveGuarantee(RESERVE_INPUT, { accountId: 42 })

      expect(mockedPaymentRail().reserve).toHaveBeenCalledWith({
        amountCents: 15000,
        payerTaxId: '11111111111',
        payerName: 'Reporter One',
        recipients: [{ railRecipientId: 'wallet_1', amountCents: 15000 }],
      })
      expect(mockedRepository.markReserved).toHaveBeenCalledWith(
        1,
        'pay_1',
        'v1',
        'crit-1',
        RESERVE_INPUT.recipients
      )
    })

    it('rejects reserving before any mediation criteria are published (decision 150)', async () => {
      mockedRepository.findActiveCriteria.mockResolvedValue(null)

      await expect(
        service.reserveGuarantee(RESERVE_INPUT, { accountId: 42 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'NOT_AVAILABLE' })
      expect(mockedPaymentRail).not.toHaveBeenCalled()
    })

    it('rejects reserving an already-reserved offer', async () => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_RESERVED)

      await expect(
        service.reserveGuarantee(RESERVE_INPUT, { accountId: 42 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    })

    it('rejects recipient amounts that do not sum to the offer amount', async () => {
      await expect(
        service.reserveGuarantee(
          { ...RESERVE_INPUT, recipients: [{ helpOfferId: 5, amountCents: 100 }] },
          { accountId: 42 }
        )
      ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    })

    it('rejects a help offer id that does not belong to the report', async () => {
      mockedRepository.findHelpOffersForRecipients.mockResolvedValue([])

      await expect(
        service.reserveGuarantee(RESERVE_INPUT, { accountId: 42 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    })

    it('rejects an anonymous helper as a recipient (precedent of decision 34)', async () => {
      mockedRepository.findHelpOffersForRecipients.mockResolvedValue([
        { id: 5, helperAccountId: null },
      ])

      await expect(
        service.reserveGuarantee(RESERVE_INPUT, { accountId: 42 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    })

    it('rejects a helper who has not onboarded to receive a payout', async () => {
      mockedRepository.findRecipientProfile.mockResolvedValue(null)

      await expect(
        service.reserveGuarantee(RESERVE_INPUT, { accountId: 42 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'NOT_AVAILABLE' })
    })
  })

  describe('mediation discipline (decision 98, closed by 148/149/150)', () => {
    beforeEach(() => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_RESERVED)
    })

    it('propose: records the outcome under the stamped criteria version and logs it', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue(null)
      mockedRepository.insertResolution.mockResolvedValue(11)

      const result = await service.proposeResolution(7, 'fulfilled', 'Condition met', { userId: 3 })

      expect(result).toEqual({ resolutionId: 11 })
      expect(mockedRepository.insertResolution).toHaveBeenCalledWith(
        1,
        'fulfilled',
        'Condition met',
        'crit-1',
        3
      )
      expect(mockedRepository.appendMediationLog).toHaveBeenCalledWith(
        1,
        'proposed',
        'user:3',
        'fulfilled'
      )
    })

    it('propose: rejects when a resolution is already in progress', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue(RESOLUTION_PROPOSED)

      await expect(
        service.proposeResolution(7, 'fulfilled', 'again', { userId: 3 })
      ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE' })
    })

    it('propose: rejects an offer that is not reserved', async () => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_OPEN)

      await expect(
        service.proposeResolution(7, 'fulfilled', 'r', { userId: 3 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    })

    it('approve: a DIFFERENT mediator opens the contest window without touching the rail (148/149)', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue(RESOLUTION_PROPOSED)

      const result = await service.approveResolution(7, { userId: 4 })

      expect(result.windowEndsAt).toBeDefined()
      expect(mockedRepository.approveResolution).toHaveBeenCalledWith(11, 4, expect.any(Date))
      expect(mockedPaymentRail).not.toHaveBeenCalled()
    })

    it('approve: rejects the proposer approving their own proposal (decision 148)', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue(RESOLUTION_PROPOSED)

      await expect(service.approveResolution(7, { userId: 3 })).rejects.toMatchObject({
        statusCode: 422,
        code: 'BUSINESS_RULE',
      })
      expect(mockedRepository.approveResolution).not.toHaveBeenCalled()
    })

    it('contest: a case party contests while the money is retained (decision 149)', async () => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_RESERVED)
      mockedRepository.findLiveResolution.mockResolvedValue(RESOLUTION_APPROVED)
      mockedRepository.findPartyAccountIds.mockResolvedValue([42, 8])
      mockedRepository.insertContest.mockResolvedValue(21)

      const result = await service.contestResolution(7, 'I disagree', { accountId: 8 })

      expect(result).toEqual({ contestId: 21 })
      expect(mockedRepository.appendMediationLog).toHaveBeenCalledWith(
        1,
        'contested',
        'account:8',
        null
      )
    })

    it('contest: rejects an account that is not a party of the case', async () => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_RESERVED)
      mockedRepository.findLiveResolution.mockResolvedValue(RESOLUTION_APPROVED)
      mockedRepository.findPartyAccountIds.mockResolvedValue([42, 8])

      await expect(
        service.contestResolution(7, 'outsider', { accountId: 99 })
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(mockedRepository.insertContest).not.toHaveBeenCalled()
    })

    it('execute: rejects while the contest window has not elapsed (decision 149)', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue({
        ...RESOLUTION_APPROVED,
        windowEndsAt: new Date(Date.now() + 60_000),
      })

      await expect(service.executeResolution(7, { userId: 5 })).rejects.toMatchObject({
        statusCode: 422,
        code: 'BUSINESS_RULE',
      })
      expect(mockedPaymentRail).not.toHaveBeenCalled()
    })

    it('execute: rejects while a contest is open (decision 149)', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue(RESOLUTION_APPROVED)
      mockedRepository.findOpenContests.mockResolvedValue([{ id: 21 } as any])

      await expect(service.executeResolution(7, { userId: 5 })).rejects.toMatchObject({
        statusCode: 422,
        code: 'BUSINESS_RULE',
      })
      expect(mockedPaymentRail).not.toHaveBeenCalled()
    })

    it('execute fulfilled: captures, marks released and closes the trail', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue(RESOLUTION_APPROVED)
      mockedRepository.findOpenContests.mockResolvedValue([])
      const rail = railMock()
      mockedPaymentRail.mockReturnValue(rail as any)

      await service.executeResolution(7, { userId: 5 })

      expect(rail.capture).toHaveBeenCalledWith('pay_1')
      expect(mockedRepository.markResolved).toHaveBeenCalledWith(1, 'released')
      expect(mockedRepository.markResolutionExecuted).toHaveBeenCalledWith(11)
      expect(mockedRepository.appendMediationLog).toHaveBeenCalledWith(
        1,
        'executed',
        'user:5',
        'fulfilled'
      )
    })

    it('execute not_fulfilled: cancels at the rail and marks refunded', async () => {
      mockedRepository.findLiveResolution.mockResolvedValue({
        ...RESOLUTION_APPROVED,
        outcome: 'not_fulfilled' as const,
      })
      mockedRepository.findOpenContests.mockResolvedValue([])
      const rail = railMock()
      mockedPaymentRail.mockReturnValue(rail as any)

      await service.executeResolution(7, { userId: 5 })

      expect(rail.cancel).toHaveBeenCalledWith('pay_1')
      expect(mockedRepository.markResolved).toHaveBeenCalledWith(1, 'refunded')
    })

    it('publishCriteria: rejects a duplicate version (decision 150 â€” versions are immutable)', async () => {
      mockedRepository.findCriteriaByVersion.mockResolvedValue(CRITERIA)

      await expect(
        service.publishCriteria('crit-1', 'new text', { userId: 3 })
      ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE' })
      expect(mockedRepository.insertCriteria).not.toHaveBeenCalled()
    })
  })

  describe('onboardAsRecipient (fills the NOT_AVAILABLE gap of reserveGuarantee)', () => {
    const ONBOARD_INPUT = {
      legalName: 'Helper One',
      email: 'helper@example.com',
      taxId: '22222222222',
      mobilePhone: '11999990000',
      monthlyIncome: 3000,
      address: {
        street: 'Rua A',
        number: '10',
        neighborhood: 'Centro',
        postalCode: '01001000',
      },
    }

    it('onboards at the rail and stores only the opaque recipient id', async () => {
      mockedRepository.findRecipientProfile.mockResolvedValue(null)
      const rail = railMock()
      rail.onboardRecipient.mockResolvedValue({ railRecipientId: 'wallet_9' })
      mockedPaymentRail.mockReturnValue(rail as any)

      await service.onboardAsRecipient(ONBOARD_INPUT, { accountId: 8 })

      expect(rail.onboardRecipient).toHaveBeenCalledWith(ONBOARD_INPUT)
      expect(mockedRepository.insertRecipientProfile).toHaveBeenCalledWith(8, 'wallet_9')
      expect(mockedAssertCapability).toHaveBeenCalledTimes(2)
    })

    it('rejects an account that is already onboarded', async () => {
      mockedRepository.findRecipientProfile.mockResolvedValue({ railRecipientId: 'wallet_9' })

      await expect(
        service.onboardAsRecipient(ONBOARD_INPUT, { accountId: 8 })
      ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE' })
      expect(mockedPaymentRail).not.toHaveBeenCalled()
    })

    it('does not store a profile when the rail onboarding fails', async () => {
      mockedRepository.findRecipientProfile.mockResolvedValue(null)
      const rail = railMock()
      rail.onboardRecipient.mockRejectedValue(new Error('rail down'))
      mockedPaymentRail.mockReturnValue(rail as any)

      await expect(
        service.onboardAsRecipient(ONBOARD_INPUT, { accountId: 8 })
      ).rejects.toThrow('rail down')
      expect(mockedRepository.insertRecipientProfile).not.toHaveBeenCalled()
    })
  })

  describe('getOnboardingStatus', () => {
    it('reports onboarded without exposing the rail id', async () => {
      mockedRepository.findRecipientProfile.mockResolvedValue({ railRecipientId: 'wallet_9' })

      expect(await service.getOnboardingStatus(8)).toEqual({ onboarded: true })
    })

    it('reports not onboarded when no profile exists', async () => {
      mockedRepository.findRecipientProfile.mockResolvedValue(null)

      expect(await service.getOnboardingStatus(8)).toEqual({ onboarded: false })
    })
  })

  describe('getRewardState (decision 85 â€” seal derives from the LIVE rail state)', () => {
    it('reconciles to refunded when the live state drifted (e.g. Asaas auto-expired)', async () => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_RESERVED)
      const rail = railMock()
      rail.getRetentionState.mockResolvedValue('refunded')
      mockedPaymentRail.mockReturnValue(rail as any)

      const result = await service.getRewardState(7)

      expect(result?.status).toBe('refunded')
      expect(mockedRepository.updateOfferStatus).toHaveBeenCalledWith(1, 'refunded')
    })

    it('does not touch the rail for an offer that was never reserved', async () => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_OPEN)

      const result = await service.getRewardState(7)

      expect(result).toEqual(OFFER_OPEN)
      expect(mockedPaymentRail).not.toHaveBeenCalled()
    })

    it('returns null when there is no offer', async () => {
      mockedRepository.findOfferByReport.mockResolvedValue(null)

      expect(await service.getRewardState(7)).toBeNull()
    })
  })
})
