import * as repository from '@modules/ratings/helper-rating.repository'
import * as service from '@modules/ratings/helper-rating.service'
import {
  HelperRatingRow,
  RatingOfferRow,
  RatingReportRow,
} from '@modules/ratings/helper-rating.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

jest.mock('@modules/ratings/helper-rating.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const REPORT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const RATING_KEY = '9b2b6c1a-0000-4000-8000-000000000002'
const OTHER_KEY = '9b2b6c1a-0000-4000-8000-000000000003'
const IP = '10.0.0.1'

const OWNER_BY_ACCOUNT = { accountId: 42, clientKey: null, ip: IP }
const OWNER_BY_KEY = { accountId: null, clientKey: REPORT_KEY, ip: IP }
const HELPER = { accountId: 8, clientKey: null, ip: IP }
const STRANGER = { accountId: null, clientKey: 'not-the-key', ip: IP }

function report(overrides: Partial<RatingReportRow> = {}): RatingReportRow {
  return {
    id: 7,
    clientKey: REPORT_KEY,
    reporterAccountId: 42,
    status: 'resolved',
    hidden: false,
    purged: false,
    ...overrides,
  }
}

function offer(overrides: Partial<RatingOfferRow> = {}): RatingOfferRow {
  return { id: 11, reportId: 7, helperAccountId: 8, anonymous: false, ...overrides }
}

function rating(overrides: Partial<HelperRatingRow> = {}): HelperRatingRow {
  return {
    id: 501,
    helpOfferId: 11,
    reportId: 7,
    helperAccountId: 8,
    score: 4,
    clientKey: RATING_KEY,
    createdAt: new Date('2026-09-03T12:00:00Z'),
    ...overrides,
  }
}

const INPUT = { score: 4, clientKey: RATING_KEY }

describe('helper-rating.service — rateHelper (RT1, decisions 48/180-183/187/188)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
    mockedRepository.findReportForRating.mockResolvedValue(report())
    mockedRepository.findOfferForRating.mockResolvedValue(offer())
    mockedRepository.findRatingByOffer.mockResolvedValue(null)
    mockedRepository.insertRating.mockResolvedValue(rating())
  })

  describe('ownership (decisions 20/134 — non-owners get 404, never 403)', () => {
    it('the owner by ACCOUNT rates; the row is read by offer id AND report id', async () => {
      const result = await service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)

      expect(result).toEqual({
        ratingId: 501,
        reportId: 7,
        helpOfferId: 11,
        score: 4,
        createdAt: '2026-09-03T12:00:00.000Z',
        replayed: false,
      })
      expect(mockedRepository.findOfferForRating).toHaveBeenCalledWith(11, 7)
    })

    it('the anonymous owner rates by presenting the report clientKey', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ reporterAccountId: null }))
      const result = await service.rateHelper(7, 11, INPUT, OWNER_BY_KEY)
      expect(result.ratingId).toBe(501)
    })

    it('a stranger with the wrong key is 404', async () => {
      await expect(service.rateHelper(7, 11, INPUT, STRANGER)).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      })
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('the helper (another account) is 404 — the helper never rates', async () => {
      await expect(service.rateHelper(7, 11, INPUT, HELPER)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('a missing or purged report is 404', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(null)
      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 404,
      })

      mockedRepository.findReportForRating.mockResolvedValue(report({ purged: true }))
      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('the offer (decisions 180/183)', () => {
    it('an offer of ANOTHER report (or a deleted one) is 404', async () => {
      mockedRepository.findOfferForRating.mockResolvedValue(null)
      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      })
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('an offer whose helper has NO account is 422 RATING_NOT_ALLOWED (180)', async () => {
      mockedRepository.findOfferForRating.mockResolvedValue(offer({ helperAccountId: null }))
      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 422,
        code: ErrorCodes.RATING_NOT_ALLOWED,
      })
      expect(mockedGate).not.toHaveBeenCalled()
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('an ANONYMOUS offer with an account is rated against that account (spec 004 scenario, 48/180)', async () => {
      mockedRepository.findOfferForRating.mockResolvedValue(offer({ anonymous: true }))

      await service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)

      expect(mockedRepository.insertRating).toHaveBeenCalledWith({
        helpOfferId: 11,
        reportId: 7,
        helperAccountId: 8,
        score: 4,
        clientKey: RATING_KEY,
      })
    })
  })

  describe('the case state (decisions 181/162/187)', () => {
    it('an OPEN case is 409 RATING_CLOSED with reason open', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ status: 'open' }))
      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.RATING_CLOSED,
        params: { reason: 'open' },
      })
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('a HIDDEN resolved case is 409 RATING_CLOSED with reason hidden (162 closes writes)', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ hidden: true }))
      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.RATING_CLOSED,
        params: { reason: 'hidden' },
      })
    })
  })

  describe('one rating per offer, immutable (decision 183, replay of 137)', () => {
    it('a second attempt with a DIFFERENT clientKey is 409 ALREADY_RATED (spec 004 scenario)', async () => {
      mockedRepository.findRatingByOffer.mockResolvedValue(rating())
      await expect(
        service.rateHelper(7, 11, { score: 1, clientKey: OTHER_KEY }, OWNER_BY_ACCOUNT)
      ).rejects.toMatchObject({ statusCode: 409, code: ErrorCodes.ALREADY_RATED })
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('a replay with the SAME clientKey answers the same rating — even if the case was hidden since', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ hidden: true }))
      mockedRepository.findRatingByOffer.mockResolvedValue(rating())

      const result = await service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)

      expect(result).toMatchObject({ ratingId: 501, score: 4, replayed: true })
      expect(mockedGate).not.toHaveBeenCalled()
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('a replay never re-judges the score sent: the STORED score is answered', async () => {
      mockedRepository.findRatingByOffer.mockResolvedValue(rating({ score: 5 }))
      const result = await service.rateHelper(7, 11, { score: 2, clientKey: RATING_KEY }, OWNER_BY_ACCOUNT)
      expect(result.score).toBe(5)
    })

    it('two replays racing on the UNIQUE keys: the winner with the same clientKey is the answer', async () => {
      mockedRepository.insertRating.mockResolvedValue(null)
      mockedRepository.findRatingByOffer
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(rating())

      const result = await service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)

      expect(result).toMatchObject({ ratingId: 501, replayed: true })
    })

    it('a race lost to a rating with ANOTHER clientKey is 409 ALREADY_RATED', async () => {
      mockedRepository.insertRating.mockResolvedValue(null)
      mockedRepository.findRatingByOffer
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(rating({ clientKey: OTHER_KEY }))

      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.ALREADY_RATED,
      })
    })

    it('a clientKey already spent on ANOTHER offer is 409 DUPLICATE — the app reused a key', async () => {
      mockedRepository.insertRating.mockResolvedValue(null)
      mockedRepository.findRatingByOffer.mockResolvedValue(null)

      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.DUPLICATE,
      })
    })
  })

  describe('Legal Gate (decision 188 — helper.rating before any write)', () => {
    it('asserts helper.rating with the account as userRef, BEFORE the insert', async () => {
      const order: string[] = []
      mockedGate.mockImplementation(async () => {
        order.push('gate')
        return { allowed: true } as any
      })
      mockedRepository.insertRating.mockImplementation(async () => {
        order.push('insert')
        return rating()
      })

      await service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)

      expect(mockedGate).toHaveBeenCalledWith(Capabilities.HELPER_RATING, { userRef: '42', ip: IP })
      expect(order).toEqual(['gate', 'insert'])
    })

    it('the anonymous owner is gated with no userRef', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ reporterAccountId: null }))
      await service.rateHelper(7, 11, INPUT, OWNER_BY_KEY)
      expect(mockedGate).toHaveBeenCalledWith(Capabilities.HELPER_RATING, { userRef: undefined, ip: IP })
    })

    it('blocked -> 451 and NOTHING is written', async () => {
      mockedGate.mockRejectedValue(
        new HttpError(451, 'Blocked', undefined, ErrorCodes.LEGAL_BLOCKED, {
          capability: 'helper.rating',
          reason: 'blocked',
        })
      )
      await expect(service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 451,
        code: ErrorCodes.LEGAL_BLOCKED,
      })
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
      expect(mockedAccountability).not.toHaveBeenCalled()
    })
  })

  describe('accountability (decision 23 — pattern of help_offer.submit)', () => {
    it('the ANONYMOUS owner leaves helper_rating.submit with the ratingId — never the score', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ reporterAccountId: null }))
      await service.rateHelper(7, 11, INPUT, OWNER_BY_KEY)
      expect(mockedAccountability).toHaveBeenCalledWith('helper_rating.submit', IP, { ratingId: 501 })
    })

    it('an owner with an ACCOUNT leaves no accountability entry (the session is the trail)', async () => {
      await service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)
      expect(mockedAccountability).not.toHaveBeenCalled()
    })

    it('an accountability failure is logged and never takes the rating down (123)', async () => {
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined)
      mockedRepository.findReportForRating.mockResolvedValue(report({ reporterAccountId: null }))
      mockedAccountability.mockRejectedValue(new Error('log down'))

      const result = await service.rateHelper(7, 11, INPUT, OWNER_BY_KEY)

      expect(result.ratingId).toBe(501)
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  it('the payload never carries the helper account id nor the report clientKey (48/60/185)', async () => {
    const result = await service.rateHelper(7, 11, INPUT, OWNER_BY_ACCOUNT)
    const json = JSON.stringify(result)
    expect(json).not.toContain('helperAccountId')
    expect(json).not.toContain(REPORT_KEY)
    expect(json).not.toContain('clientKey')
  })
})

describe('helper-rating.service — getMyReputation (decisions 184/185/187)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('reads the aggregate of the caller ONLY, by internal account id', async () => {
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 5, average: 4.2 })
    const result = await service.getMyReputation(8)
    expect(result).toEqual({ count: 5, average: 4.2 })
    expect(mockedRepository.aggregateByHelperInternalId).toHaveBeenCalledWith(8)
  })

  it('average is null below the k = 5 floor (184) — count still answered', async () => {
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 3, average: 5 })
    expect(await service.getMyReputation(8)).toEqual({ count: 3, average: null })
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 4, average: 1 })
    expect(await service.getMyReputation(8)).toEqual({ count: 4, average: null })
  })

  it('no ratings yet: { count: 0, average: null }', async () => {
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 0, average: null })
    expect(await service.getMyReputation(8)).toEqual({ count: 0, average: null })
  })

  it('average is rounded to 2 decimals at the floor and above', async () => {
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 6, average: 4.333333 })
    expect(await service.getMyReputation(8)).toEqual({ count: 6, average: 4.33 })
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 5, average: 3.875 })
    expect((await service.getMyReputation(8)).average).toBe(3.88)
  })

  it('never exposes anything per case — only count and average leave', async () => {
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 7, average: 4 })
    const result = await service.getMyReputation(8)
    expect(Object.keys(result).sort()).toEqual(['average', 'count'])
  })
})
