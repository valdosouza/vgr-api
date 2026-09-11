import * as repository from '@modules/help-offers/help-offers.repository'
import * as service from '@modules/help-offers/help-offers.service'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'

jest.mock('@modules/help-offers/help-offers.repository')
jest.mock('@shared/audit/accountability')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const INPUT = {
  reportId: 7,
  helpTypes: ['physical_presence' as const, 'share' as const],
  anonymous: false,
}

describe('help-offers.service (decisions 10/18/20/34/35)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.findReportForOffer.mockResolvedValue({
      id: 7,
      reporterAccountId: 42,
      status: 'open',
    })
    mockedRepository.insertHelpOffer.mockResolvedValue(11)
  })

  it('an anonymous offer is accepted in full (35) and leaves the accountability trail (23)', async () => {
    const result = await service.submitHelpOffer(INPUT, { accountId: null, ip: '10.0.0.1' })

    expect(result).toEqual({ helpOfferId: 11 })
    expect(mockedRepository.insertHelpOffer).toHaveBeenCalledWith(
      expect.objectContaining({ helperAccountId: null, anonymous: true })
    )
    expect(mockedAccountability).toHaveBeenCalledWith('help_offer.submit', '10.0.0.1', {
      helpOfferId: 11,
    })
  })

  it('a logged-in helper choosing anonymity keeps the account internally (6/23)', async () => {
    await service.submitHelpOffer({ ...INPUT, anonymous: true }, { accountId: 8, ip: '10.0.0.1' })
    expect(mockedRepository.insertHelpOffer).toHaveBeenCalledWith(
      expect.objectContaining({ helperAccountId: 8, anonymous: true })
    )
    expect(mockedAccountability).not.toHaveBeenCalled()
  })

  it('the reporter cannot help their own report (20)', async () => {
    await expect(
      service.submitHelpOffer(INPUT, { accountId: 42, ip: '10.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
    expect(mockedRepository.insertHelpOffer).not.toHaveBeenCalled()
  })

  it('a resolved report takes no NEW offers (18 keeps only existing links)', async () => {
    mockedRepository.findReportForOffer.mockResolvedValue({
      id: 7,
      reporterAccountId: 42,
      status: 'resolved',
    })
    await expect(
      service.submitHelpOffer(INPUT, { accountId: 8, ip: '10.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('a second identified offer on the same report is a 409', async () => {
    mockedRepository.insertHelpOffer.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
    )
    await expect(
      service.submitHelpOffer(INPUT, { accountId: 8, ip: '10.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE' })
  })

  it('the timeline event carries the whole set of fronts and NEVER the helper identity (6/60/212)', async () => {
    await service.submitHelpOffer(INPUT, { accountId: 8, ip: '10.0.0.1' })
    expect(mockedRepository.insertHelpOffer).toHaveBeenCalledWith(
      expect.objectContaining({ helpTypes: ['physical_presence', 'share'] })
    )
    expect(mockedRepository.appendHelpOfferedEvent).toHaveBeenCalledWith(7, [
      'physical_presence',
      'share',
    ])
  })

  it('a missing or purged report answers 404', async () => {
    mockedRepository.findReportForOffer.mockResolvedValue(null)
    await expect(
      service.submitHelpOffer(INPUT, { accountId: 8, ip: '10.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  describe('updateHelpOfferTypes (decision 211)', () => {
    const offer = (overrides: Record<string, unknown> = {}) => ({
      id: 11,
      reportId: 7,
      helperAccountId: 8,
      anonymous: false,
      helpTypes: ['share' as const],
      createdAt: new Date('2026-09-11T00:00:00Z'),
      reportStatus: 'open',
      ...overrides,
    })

    it('the helper of the offer replaces the set and the timeline gets its own item (212)', async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(offer())

      const result = await service.updateHelpOfferTypes(
        { helpOfferId: 11, helpTypes: ['physical_presence', 'remote_support'] },
        { accountId: 8 }
      )

      expect(result).toEqual({ helpOfferId: 11, helpTypes: ['physical_presence', 'remote_support'] })
      expect(mockedRepository.replaceHelpOfferTypes).toHaveBeenCalledWith(11, [
        'physical_presence',
        'remote_support',
      ])
      expect(mockedRepository.appendHelpOfferUpdatedEvent).toHaveBeenCalledWith(7, [
        'physical_presence',
        'remote_support',
      ])
    })

    it('a logged-in helper who CHOSE anonymity still owns the offer by account (23)', async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(offer({ anonymous: true }))
      await expect(
        service.updateHelpOfferTypes({ helpOfferId: 11, helpTypes: ['share'] }, { accountId: 8 })
      ).resolves.toMatchObject({ helpOfferId: 11 })
    })

    it("someone else's offer is a 404, never a hint that it exists", async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(offer())
      await expect(
        service.updateHelpOfferTypes({ helpOfferId: 11, helpTypes: ['share'] }, { accountId: 9 })
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
      expect(mockedRepository.replaceHelpOfferTypes).not.toHaveBeenCalled()
    })

    it('a fully anonymous offer (no account) cannot be claimed by anyone', async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(
        offer({ helperAccountId: null, anonymous: true })
      )
      await expect(
        service.updateHelpOfferTypes({ helpOfferId: 11, helpTypes: ['share'] }, { accountId: 8 })
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('a resolved report freezes the set (18)', async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(offer({ reportStatus: 'resolved' }))
      await expect(
        service.updateHelpOfferTypes({ helpOfferId: 11, helpTypes: ['share'] }, { accountId: 8 })
      ).rejects.toMatchObject({ statusCode: 422, code: 'BUSINESS_RULE' })
      expect(mockedRepository.replaceHelpOfferTypes).not.toHaveBeenCalled()
    })

    it('a missing or deleted offer is a 404', async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(null)
      await expect(
        service.updateHelpOfferTypes({ helpOfferId: 11, helpTypes: ['share'] }, { accountId: 8 })
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})
