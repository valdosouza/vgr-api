import * as repository from '@modules/help-offers/help-offers.repository'
import * as service from '@modules/help-offers/help-offers.service'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'

jest.mock('@modules/help-offers/help-offers.repository')
jest.mock('@shared/audit/accountability')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const INPUT = { reportId: 7, helpType: 'physical_presence' as const, anonymous: false }

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

  it('the timeline event carries the help type and NEVER the helper identity (6/60)', async () => {
    await service.submitHelpOffer(INPUT, { accountId: 8, ip: '10.0.0.1' })
    expect(mockedRepository.appendHelpOfferedEvent).toHaveBeenCalledWith(7, 'physical_presence')
  })

  it('a missing or purged report answers 404', async () => {
    mockedRepository.findReportForOffer.mockResolvedValue(null)
    await expect(
      service.submitHelpOffer(INPUT, { accountId: 8, ip: '10.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
