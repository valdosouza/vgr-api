import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/users/user.service'
import * as aclStore from '@shared/acl/privilege-store'

jest.mock('@modules/users/user.service')
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
  { id: 2, name: 'Ana', email: 'ana@vgr.com.br', active: 'S' as const, locale: null, lastLoginAt: null },
]

/** GET /api/users under PS0 (decision 220): optional page/pageSize/filter. */
describe('GET /api/users — paging (decision 220)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockResolvedValue(true)
  })

  it('without page answers the legacy plain array', async () => {
    mockedService.listUsers.mockResolvedValue(rows)

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: rows })
    expect(mockedService.listUsers.mock.calls[0][0]).not.toHaveProperty('page')
  })

  it('with page=2&pageSize=10 answers { items, page, pageSize, total } in data', async () => {
    const paged = { items: rows, page: 2, pageSize: 10, total: 11 }
    mockedService.listUsers.mockResolvedValue(paged)

    const res = await request(app)
      .get('/api/users?page=2&pageSize=10')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: paged })
    expect(mockedService.listUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10 }))
  })

  it('pageSize=1000 answers 422 VALIDATION_FAILED and never reaches the service', async () => {
    const res = await request(app)
      .get('/api/users?page=1&pageSize=1000')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(mockedService.listUsers).not.toHaveBeenCalled()
  })

  it('forwards a trimmed filter', async () => {
    mockedService.listUsers.mockResolvedValue(rows)

    await request(app).get('/api/users?filter=%20ana%20').set('Authorization', `Bearer ${token()}`)

    expect(mockedService.listUsers).toHaveBeenCalledWith(expect.objectContaining({ filter: 'ana' }))
  })
})
