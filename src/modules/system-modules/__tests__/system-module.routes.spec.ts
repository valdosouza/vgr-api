import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/system-modules/system-module.service'
import * as aclStore from '@shared/acl/privilege-store'

jest.mock('@modules/system-modules/system-module.service')
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

const rows = [
  { id: 2, description: 'Administration', i18nKey: null, imageIcon: null, position: 0, interfaceIds: [4] },
]

/** GET /api/system-modules under PS0 (decision 220): optional page/pageSize/filter. */
describe('GET /api/system-modules — paging (decision 220)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockResolvedValue(true)
  })

  it('without page answers the legacy plain array', async () => {
    mockedService.listSystemModules.mockResolvedValue(rows)

    const res = await request(app).get('/api/system-modules').set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: rows })
    expect(mockedService.listSystemModules.mock.calls[0][0]).not.toHaveProperty('page')
  })

  it('with page=2&pageSize=10 answers { items, page, pageSize, total } in data', async () => {
    const paged = { items: rows, page: 2, pageSize: 10, total: 11 }
    mockedService.listSystemModules.mockResolvedValue(paged)

    const res = await request(app)
      .get('/api/system-modules?page=2&pageSize=10')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: paged })
    expect(mockedService.listSystemModules).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 })
    )
  })

  it('pageSize=1000 answers 422 VALIDATION_FAILED and never reaches the service', async () => {
    const res = await request(app)
      .get('/api/system-modules?page=1&pageSize=1000')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(mockedService.listSystemModules).not.toHaveBeenCalled()
  })

  it('forwards a trimmed filter', async () => {
    mockedService.listSystemModules.mockResolvedValue(rows)

    await request(app)
      .get('/api/system-modules?filter=%20adm%20')
      .set('Authorization', `Bearer ${token()}`)

    expect(mockedService.listSystemModules).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'adm' })
    )
  })
})
