import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/legal-policy/legal-policy.service'
import * as aclStore from '@shared/acl/privilege-store'
import { JurisdictionAdminRow } from '@modules/legal-policy/legal-policy.interface'

jest.mock('@modules/legal-policy/legal-policy.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store', () => ({
  getSessionInfo: async () => ({ sessionVersion: 1, active: true }),
  invalidateSession: () => undefined,
  invalidateAllSessions: () => undefined,
}))

const mockedService = service as jest.Mocked<typeof service>
const mockedAcl = aclStore as jest.Mocked<typeof aclStore>

const token = () =>
  jwt.sign({ userId: 1, role: 'admin', sv: 1 }, 'test-secret', { audience: 'admin' })

const jurisdiction: JurisdictionAdminRow = {
  code: 'BR',
  name: 'Brazil',
  operationalState: 'live',
  isSandbox: false,
  pendingState: null,
  pendingBy: null,
}

/** The three Legal Gate admin lists under PS0 (decision 220). */
describe('/api/legal-policy lists — paging (decision 220)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockResolvedValue(true)
  })

  describe('GET /jurisdictions', () => {
    it('without page answers the legacy plain array', async () => {
      mockedService.listJurisdictions.mockResolvedValue([jurisdiction])

      const res = await request(app)
        .get('/api/legal-policy/jurisdictions')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, data: [jurisdiction] })
      expect(mockedService.listJurisdictions.mock.calls[0][0]).not.toHaveProperty('page')
    })

    it('with page=2&pageSize=10 answers the paged shape in data and forwards the filter', async () => {
      const paged = { items: [jurisdiction], page: 2, pageSize: 10, total: 11 }
      mockedService.listJurisdictions.mockResolvedValue(paged)

      const res = await request(app)
        .get('/api/legal-policy/jurisdictions?page=2&pageSize=10&filter=%20bra%20')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, data: paged })
      expect(mockedService.listJurisdictions).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 10, filter: 'bra' })
      )
    })

    it('pageSize=1000 answers 422 VALIDATION_FAILED', async () => {
      const res = await request(app)
        .get('/api/legal-policy/jurisdictions?page=1&pageSize=1000')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(422)
      expect(res.body.code).toBe('VALIDATION_FAILED')
      expect(mockedService.listJurisdictions).not.toHaveBeenCalled()
    })
  })

  describe('GET /capabilities', () => {
    it('still answers 422 REQUIRED on the jurisdiction field when it is missing (legacy contract)', async () => {
      const res = await request(app)
        .get('/api/legal-policy/capabilities')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(422)
      expect(res.body.code).toBe('VALIDATION_FAILED')
      expect(res.body.fields).toEqual([expect.objectContaining({ field: 'jurisdiction', code: 'REQUIRED' })])
      expect(mockedService.listCapabilities).not.toHaveBeenCalled()
    })

    it('without page answers the legacy plain array for the jurisdiction', async () => {
      mockedService.listCapabilities.mockResolvedValue([])

      const res = await request(app)
        .get('/api/legal-policy/capabilities?jurisdiction=BR')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, data: [] })
      expect(mockedService.listCapabilities).toHaveBeenCalledWith('BR', expect.any(Object))
      expect(mockedService.listCapabilities.mock.calls[0][1]).not.toHaveProperty('page')
    })

    it('with page answers the paged shape and forwards page/pageSize/filter', async () => {
      const paged = { items: [], page: 2, pageSize: 10, total: 0 }
      mockedService.listCapabilities.mockResolvedValue(paged)

      const res = await request(app)
        .get('/api/legal-policy/capabilities?jurisdiction=BR&page=2&pageSize=10&filter=reward')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, data: paged })
      expect(mockedService.listCapabilities).toHaveBeenCalledWith(
        'BR',
        expect.objectContaining({ page: 2, pageSize: 10, filter: 'reward' })
      )
    })

    it('pageSize=1000 answers 422 VALIDATION_FAILED', async () => {
      const res = await request(app)
        .get('/api/legal-policy/capabilities?jurisdiction=BR&page=1&pageSize=1000')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(422)
      expect(mockedService.listCapabilities).not.toHaveBeenCalled()
    })
  })

  describe('GET /rules', () => {
    it('without page keeps the legacy plain array and the exact capability/jurisdiction filters', async () => {
      mockedService.listRules.mockResolvedValue([])

      const res = await request(app)
        .get('/api/legal-policy/rules?capability=chat.masked&jurisdiction=BR')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, data: [] })
      expect(mockedService.listRules).toHaveBeenCalledWith(
        expect.objectContaining({ capability: 'chat.masked', jurisdiction: 'BR' })
      )
      expect(mockedService.listRules.mock.calls[0][0]).not.toHaveProperty('page')
    })

    it('with page answers the paged shape and forwards the text filter', async () => {
      const paged = { items: [], page: 3, pageSize: 5, total: 0 }
      mockedService.listRules.mockResolvedValue(paged)

      const res = await request(app)
        .get('/api/legal-policy/rules?page=3&pageSize=5&filter=LGPD')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, data: paged })
      expect(mockedService.listRules).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3, pageSize: 5, filter: 'LGPD' })
      )
    })

    it('pageSize=1000 answers 422 VALIDATION_FAILED', async () => {
      const res = await request(app)
        .get('/api/legal-policy/rules?page=1&pageSize=1000')
        .set('Authorization', `Bearer ${token()}`)

      expect(res.status).toBe(422)
      expect(mockedService.listRules).not.toHaveBeenCalled()
    })
  })
})
