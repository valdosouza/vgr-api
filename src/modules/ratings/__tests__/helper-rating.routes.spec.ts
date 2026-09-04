import request from 'supertest'
import app from '../../../app'
import * as repository from '@modules/ratings/helper-rating.repository'
import * as accountRepository from '@modules/accounts/account.repository'
import {
  HelperRatingRow,
  RatingOfferRow,
  RatingReportRow,
} from '@modules/ratings/helper-rating.interface'
import { signAppAccessToken } from '@shared/auth/app-session'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/ratings/helper-rating.repository')
jest.mock('@modules/accounts/account.repository')
// Automocked so the "reports routes still answer" probe never reaches a
// database: reports.service answers 404 on an undefined report row.
jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAccounts = accountRepository as jest.Mocked<typeof accountRepository>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const REPORT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const RATING_KEY = '9b2b6c1a-0000-4000-8000-000000000002'
const OTHER_KEY = '9b2b6c1a-0000-4000-8000-000000000003'
const PATH = '/app-reports/7/offers/11/rating'

function account(id: number) {
  return {
    id,
    displayName: 'Ana',
    email: 'ana@example.com',
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    passwordHash: null,
    jurisdiction: 'BR',
    consentVersion: 'v1',
    sessionVersion: 1,
    failedLoginCount: 0,
    totpSecret: null,
    totpEnabled: false,
    active: true,
  } as any
}

const ownerToken = () => `Bearer ${signAppAccessToken(42, 1)}`
const helperToken = () => `Bearer ${signAppAccessToken(8, 1)}`

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

const BODY = { score: 4, clientKey: RATING_KEY }

describe('helper rating routes (RT1 — decisions 48, 178-189)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedAccounts.findAccountById.mockImplementation(async (id) => account(id))
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
    mockedRepository.findReportForRating.mockResolvedValue(report())
    mockedRepository.findOfferForRating.mockResolvedValue(offer())
    mockedRepository.findRatingByOffer.mockResolvedValue(null)
    mockedRepository.insertRating.mockResolvedValue(rating())
    mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 0, average: null })
  })

  describe('POST /app-reports/:reportId/offers/:offerId/rating', () => {
    it('201 with the rating shape on the first accept (account owner)', async () => {
      const res = await request(app).post(PATH).set('Authorization', ownerToken()).send(BODY)

      expect(res.status).toBe(201)
      expect(res.body).toEqual({
        ratingId: 501,
        reportId: 7,
        helpOfferId: 11,
        score: 4,
        createdAt: '2026-09-03T12:00:00.000Z',
      })
      expect(mockedRepository.findOfferForRating).toHaveBeenCalledWith(11, 7)
    })

    it('the anonymous owner rates by the x-client-key HEADER and leaves the accountability trail (23)', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ reporterAccountId: null }))

      const res = await request(app).post(PATH).set('x-client-key', REPORT_KEY).send(BODY)

      expect(res.status).toBe(201)
      expect(mockedAccountability).toHaveBeenCalledWith('helper_rating.submit', expect.any(String), {
        ratingId: 501,
      })
    })

    it('the clientKey in the URL is never an ownership proof — 404', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ reporterAccountId: null }))
      const res = await request(app).post(`${PATH}?clientKey=${REPORT_KEY}`).send(BODY)
      expect(res.status).toBe(404)
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('200 (not 201) with the SAME rating on an offline-queue replay (137/183)', async () => {
      mockedRepository.findRatingByOffer.mockResolvedValue(rating())

      const res = await request(app).post(PATH).set('Authorization', ownerToken()).send(BODY)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        ratingId: 501,
        reportId: 7,
        helpOfferId: 11,
        score: 4,
        createdAt: '2026-09-03T12:00:00.000Z',
      })
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('409 ALREADY_RATED on a second rating with another clientKey (183)', async () => {
      mockedRepository.findRatingByOffer.mockResolvedValue(rating())
      const res = await request(app)
        .post(PATH)
        .set('Authorization', ownerToken())
        .send({ score: 1, clientKey: OTHER_KEY })
      expect(res.status).toBe(409)
      expect(res.body).toEqual({ error: expect.any(String), code: ErrorCodes.ALREADY_RATED })
    })

    it('409 RATING_CLOSED with params.reason open / hidden (181/162)', async () => {
      mockedRepository.findReportForRating.mockResolvedValue(report({ status: 'open' }))
      const open = await request(app).post(PATH).set('Authorization', ownerToken()).send(BODY)
      expect(open.status).toBe(409)
      expect(open.body).toEqual({
        error: expect.any(String),
        code: ErrorCodes.RATING_CLOSED,
        params: { reason: 'open' },
      })

      mockedRepository.findReportForRating.mockResolvedValue(report({ hidden: true }))
      const hidden = await request(app).post(PATH).set('Authorization', ownerToken()).send(BODY)
      expect(hidden.status).toBe(409)
      expect(hidden.body.params).toEqual({ reason: 'hidden' })
    })

    it('422 RATING_NOT_ALLOWED when the helper has no account (180)', async () => {
      mockedRepository.findOfferForRating.mockResolvedValue(offer({ helperAccountId: null }))
      const res = await request(app).post(PATH).set('Authorization', ownerToken()).send(BODY)
      expect(res.status).toBe(422)
      expect(res.body.code).toBe(ErrorCodes.RATING_NOT_ALLOWED)
    })

    it('404 for a non-owner (helper, stranger, bare request) — never 403', async () => {
      const helper = await request(app).post(PATH).set('Authorization', helperToken()).send(BODY)
      const wrongKey = await request(app).post(PATH).set('x-client-key', 'wrong').send(BODY)
      const bare = await request(app).post(PATH).send(BODY)
      for (const res of [helper, wrongKey, bare]) {
        expect(res.status).toBe(404)
        expect(res.body.code).toBe(ErrorCodes.NOT_FOUND)
      }
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it('404 for an offer of another report', async () => {
      mockedRepository.findOfferForRating.mockResolvedValue(null)
      const res = await request(app).post(PATH).set('Authorization', ownerToken()).send(BODY)
      expect(res.status).toBe(404)
    })

    it('451 LEGAL_BLOCKED before any INSERT when helper.rating is blocked (188)', async () => {
      mockedGate.mockRejectedValue(
        new HttpError(451, 'Blocked for legal reasons in this jurisdiction', undefined, ErrorCodes.LEGAL_BLOCKED, {
          capability: 'helper.rating',
          reason: 'blocked',
        })
      )
      const res = await request(app).post(PATH).set('Authorization', ownerToken()).send(BODY)
      expect(res.status).toBe(451)
      expect(res.body.code).toBe(ErrorCodes.LEGAL_BLOCKED)
      expect(res.body.params.capability).toBe('helper.rating')
      expect(mockedRepository.insertRating).not.toHaveBeenCalled()
    })

    it.each([
      ['0', 0],
      ['6', 6],
      ['4.5', 4.5],
      ['"5" (a string)', '5'],
      ['missing', undefined],
    ])('score %s is 422 VALIDATION_FAILED on the score field (182)', async (_label, score) => {
      const res = await request(app)
        .post(PATH)
        .set('Authorization', ownerToken())
        .send({ score, clientKey: RATING_KEY })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      expect(res.body.fields).toEqual([expect.objectContaining({ field: 'score' })])
      expect(mockedRepository.findReportForRating).not.toHaveBeenCalled()
    })

    it('a clientKey that is not a UUID is 422 (137 pattern)', async () => {
      const res = await request(app)
        .post(PATH)
        .set('Authorization', ownerToken())
        .send({ score: 5, clientKey: 'abc' })
      expect(res.status).toBe(422)
      expect(res.body.fields).toEqual([expect.objectContaining({ field: 'clientKey' })])
    })

    it('a bad report or offer id is 400 INVALID_ID', async () => {
      const a = await request(app).post('/app-reports/abc/offers/11/rating').send(BODY)
      const b = await request(app).post('/app-reports/7/offers/abc/rating').send(BODY)
      for (const res of [a, b]) {
        expect(res.status).toBe(400)
        expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
      }
    })

    it('a PRESENT but invalid app token is 401, never downgraded to anonymous', async () => {
      const res = await request(app).post(PATH).set('Authorization', 'Bearer forged').send(BODY)
      expect(res.status).toBe(401)
    })

    it('immutable (183): there is no PUT nor DELETE on the rating', async () => {
      const put = await request(app).put(PATH).set('Authorization', ownerToken()).send(BODY)
      const del = await request(app).delete(PATH).set('Authorization', ownerToken())
      expect(put.status).toBe(404)
      expect(del.status).toBe(404)
      expect(mockedRepository.findReportForRating).not.toHaveBeenCalled()
    })

    it('the existing report routes still answer on their own paths (the extra mount steals nothing)', async () => {
      const res = await request(app).post('/app-reports/7/resolve')
      // 404 comes from reports.service (automocked reports repository):
      // the request went to the reports router, never to the rating module.
      expect(res.status).toBe(404)
      expect(mockedRepository.findReportForRating).not.toHaveBeenCalled()
      expect(mockedRepository.findOfferForRating).not.toHaveBeenCalled()
    })

    it('is never mounted under the panel plane (/api)', async () => {
      const res = await request(app).post(`/api${PATH}`).set('Authorization', ownerToken()).send(BODY)
      expect(res.status).toBe(401)
      expect(mockedRepository.findReportForRating).not.toHaveBeenCalled()
    })
  })

  describe('GET /app-ratings/me (decisions 184/185)', () => {
    it('401 without an app token — anonymous helpers have no reputation to read', async () => {
      const bare = await request(app).get('/app-ratings/me')
      const byKey = await request(app).get('/app-ratings/me').set('x-client-key', REPORT_KEY)
      expect(bare.status).toBe(401)
      expect(bare.body.code).toBe(ErrorCodes.UNAUTHORIZED)
      expect(byKey.status).toBe(401)
      expect(mockedRepository.aggregateByHelperInternalId).not.toHaveBeenCalled()
    })

    it('200 { count, average } of the CALLER only — average null under the k = 5 floor', async () => {
      mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 3, average: 4.5 })
      const res = await request(app).get('/app-ratings/me').set('Authorization', helperToken())
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ count: 3, average: null })
      expect(mockedRepository.aggregateByHelperInternalId).toHaveBeenCalledWith(8)
    })

    it('200 with the rounded average at the floor', async () => {
      mockedRepository.aggregateByHelperInternalId.mockResolvedValue({ count: 5, average: 4.333 })
      const res = await request(app).get('/app-ratings/me').set('Authorization', helperToken())
      expect(res.body).toEqual({ count: 5, average: 4.33 })
    })

    it('there is no way to read ANOTHER account (185): no :id route exists', async () => {
      const res = await request(app).get('/app-ratings/42').set('Authorization', helperToken())
      expect(res.status).toBe(404)
      expect(mockedRepository.aggregateByHelperInternalId).not.toHaveBeenCalled()
    })

    it('is never mounted under the panel plane (/api)', async () => {
      const res = await request(app).get('/api/app-ratings/me').set('Authorization', helperToken())
      expect(res.status).toBe(401)
      expect(mockedRepository.aggregateByHelperInternalId).not.toHaveBeenCalled()
    })
  })
})
