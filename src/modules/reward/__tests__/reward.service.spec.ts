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
  createdAt: new Date(),
  resolvedAt: null,
}

const OFFER_RESERVED = {
  ...OFFER_OPEN,
  guaranteeMode: 'reserved' as const,
  status: 'reserved' as const,
  railChargeId: 'pay_1',
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

  describe('reserveGuarantee (decision 147 — recipients fixed here)', () => {
    const RESERVE_INPUT = {
      reportId: 7,
      noReturnNoticeVersion: 'v1',
      payerTaxId: '11111111111',
      payerName: 'Reporter One',
      recipients: [{ helpOfferId: 5, amountCents: 15000 }],
    }

    beforeEach(() => {
      mockedRepository.findOfferByReport.mockResolvedValue(OFFER_OPEN)
      mockedRepository.findHelpOffersForRecipients.mockResolvedValue([
        { id: 5, helperAccountId: 8 },
      ])
      mockedRepository.findRecipientProfile.mockResolvedValue({ railRecipientId: 'wallet_1' })
      const rail = railMock()
      rail.reserve.mockResolvedValue({ railChargeId: 'pay_1' })
      mockedPaymentRail.mockReturnValue(rail as any)
    })

    it('reserves against the fixed recipient set and records the rail charge id', async () => {
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
        RESERVE_INPUT.recipients
      )
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

  describe('resolveReward (decision 98/147 — judges the fixed set, does not choose it)', () => {
    it('fulfilled: captures and marks released', async () => {
      mockedRepository.findOfferById.mockResolvedValue(OFFER_RESERVED)
      const rail = railMock()
      mockedPaymentRail.mockReturnValue(rail as any)

      await service.resolveReward(1, 'fulfilled', { userId: 3 })

      expect(rail.capture).toHaveBeenCalledWith('pay_1')
      expect(mockedRepository.markResolved).toHaveBeenCalledWith(1, 'released')
    })

    it('not_fulfilled: cancels and marks refunded', async () => {
      mockedRepository.findOfferById.mockResolvedValue(OFFER_RESERVED)
      const rail = railMock()
      mockedPaymentRail.mockReturnValue(rail as any)

      await service.resolveReward(1, 'not_fulfilled', { userId: 3 })

      expect(rail.cancel).toHaveBeenCalledWith('pay_1')
      expect(mockedRepository.markResolved).toHaveBeenCalledWith(1, 'refunded')
    })

    it('rejects resolving an offer that is not reserved', async () => {
      mockedRepository.findOfferById.mockResolvedValue(OFFER_OPEN)

      await expect(
        service.resolveReward(1, 'fulfilled', { userId: 3 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    })

    it('404s on a missing offer', async () => {
      mockedRepository.findOfferById.mockResolvedValue(null)

      await expect(
        service.resolveReward(1, 'fulfilled', { userId: 3 })
      ).rejects.toMatchObject({ statusCode: 404 })
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

  describe('getRewardState (decision 85 — seal derives from the LIVE rail state)', () => {
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
