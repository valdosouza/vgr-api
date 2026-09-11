import request from 'supertest'
import app from '../../../app'
import * as repository from '@modules/help-offers/help-offers.repository'
import * as accountRepository from '@modules/accounts/account.repository'
import { signAppAccessToken } from '@shared/auth/app-session'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'

jest.mock('@modules/help-offers/help-offers.repository')
jest.mock('@modules/accounts/account.repository')
jest.mock('@shared/audit/accountability')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAccounts = accountRepository as jest.Mocked<typeof accountRepository>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

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

const helperToken = () => `Bearer ${signAppAccessToken(8, 1)}`

/** Help offers over HTTP — the contract of decisions 208/211/213: a SET
 *  of fronts per offer, replaceable by its helper while the case is open. */
describe('help-offers routes (decisions 10/20/34/35, 208-214)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedAccounts.findAccountById.mockImplementation(async (id) => account(id))
    mockedRepository.findReportForOffer.mockResolvedValue({
      id: 7,
      reporterAccountId: 42,
      status: 'open',
    })
    mockedRepository.insertHelpOffer.mockResolvedValue(11)
    mockedAccountability.mockResolvedValue(undefined as any)
  })

  describe('POST /app-help-offers', () => {
    it('accepts several fronts at once (208) and stores them all', async () => {
      const res = await request(app)
        .post('/app-help-offers')
        .send({ reportId: 7, helpTypes: ['physical_presence', 'share'] })

      expect(res.status).toBe(201)
      expect(res.body).toEqual({ helpOfferId: 11 })
      expect(mockedRepository.insertHelpOffer).toHaveBeenCalledWith(
        expect.objectContaining({ helpTypes: ['physical_presence', 'share'] })
      )
    })

    it.each([
      ['an empty set', []],
      ['a repeated front', ['share', 'share']],
      ['an unknown front', ['teleport']],
    ])('rejects %s with 422 (213)', async (_label, helpTypes) => {
      const res = await request(app).post('/app-help-offers').send({ reportId: 7, helpTypes })
      expect(res.status).toBe(422)
      expect(mockedRepository.insertHelpOffer).not.toHaveBeenCalled()
    })

    it('the singular helpType of the old contract is gone (213)', async () => {
      const res = await request(app)
        .post('/app-help-offers')
        .send({ reportId: 7, helpType: 'share' })
      expect(res.status).toBe(422)
    })
  })

  describe('PUT /app-help-offers/:id/types (211)', () => {
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

    it('needs an app session — anonymous callers cannot claim an offer', async () => {
      const res = await request(app)
        .put('/app-help-offers/11/types')
        .send({ helpTypes: ['share'] })
      expect(res.status).toBe(401)
      expect(mockedRepository.replaceHelpOfferTypes).not.toHaveBeenCalled()
    })

    it('the helper of the offer replaces the whole set', async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(offer())

      const res = await request(app)
        .put('/app-help-offers/11/types')
        .set('Authorization', helperToken())
        .send({ helpTypes: ['remote_support', 'financial_contribution'] })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        helpOfferId: 11,
        helpTypes: ['remote_support', 'financial_contribution'],
      })
      expect(mockedRepository.replaceHelpOfferTypes).toHaveBeenCalledWith(11, [
        'remote_support',
        'financial_contribution',
      ])
      expect(mockedRepository.appendHelpOfferUpdatedEvent).toHaveBeenCalledWith(7, [
        'remote_support',
        'financial_contribution',
      ])
    })

    it('the same set rules apply: an empty set is 422', async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(offer())
      const res = await request(app)
        .put('/app-help-offers/11/types')
        .set('Authorization', helperToken())
        .send({ helpTypes: [] })
      expect(res.status).toBe(422)
      expect(mockedRepository.replaceHelpOfferTypes).not.toHaveBeenCalled()
    })

    it("another account's offer is a 404", async () => {
      mockedRepository.findOfferForUpdate.mockResolvedValue(offer({ helperAccountId: 9 }))
      const res = await request(app)
        .put('/app-help-offers/11/types')
        .set('Authorization', helperToken())
        .send({ helpTypes: ['share'] })
      expect(res.status).toBe(404)
    })

    it('a malformed id is 422', async () => {
      const res = await request(app)
        .put('/app-help-offers/abc/types')
        .set('Authorization', helperToken())
        .send({ helpTypes: ['share'] })
      expect(res.status).toBe(422)
    })
  })
})
