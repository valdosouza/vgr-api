import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/privileges/privilege.service'
import * as aclStore from '@shared/acl/privilege-store'

jest.mock('@modules/privileges/privilege.service')
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

const rows = [{ id: 1, description: 'VIEW' }]

/** GET /api/privileges under PS0 (decision 220): optional page/pageSize/filter. */
describe('GET /api/privileges — paging (decision 220)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockResolvedValue(true)
  })

  it('without page answers the legacy plain array', async () => {
    mockedService.listPrivileges.mockResolvedValue(rows)

    const res = await request(app).get('/api/privileges').set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: rows })
    expect(mockedService.listPrivileges.mock.calls[0][0]).not.toHaveProperty('page')
  })

  it('with page=2&pageSize=10 answers { items, page, pageSize, total } in data', async () => {
    const paged = { items: rows, page: 2, pageSize: 10, total: 11 }
    mockedService.listPrivileges.mockResolvedValue(paged)

    const res = await request(app)
      .get('/api/privileges?page=2&pageSize=10')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: paged })
    expect(mockedService.listPrivileges).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 })
    )
  })

  it('pageSize=1000 answers 422 VALIDATION_FAILED and never reaches the service', async () => {
    const res = await request(app)
      .get('/api/privileges?page=1&pageSize=1000')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(res.body.fields[0].field).toBe('pageSize')
    expect(mockedService.listPrivileges).not.toHaveBeenCalled()
  })

  it('forwards a trimmed filter', async () => {
    mockedService.listPrivileges.mockResolvedValue(rows)

    await request(app)
      .get('/api/privileges?filter=%20VIE%20')
      .set('Authorization', `Bearer ${token()}`)

    expect(mockedService.listPrivileges).toHaveBeenCalledWith(expect.objectContaining({ filter: 'VIE' }))
  })
})
