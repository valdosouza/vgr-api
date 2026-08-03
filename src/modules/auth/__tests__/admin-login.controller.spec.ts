import request from 'supertest'
import app from '../../../app'
import * as service from '../admin-login.service'

jest.mock('../admin-login.service')

const mockedService = service as jest.Mocked<typeof service>

describe('POST /auth/admin-login', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns 200 with the jwt on success', async () => {
    mockedService.authenticateAdmin.mockResolvedValue('fake.jwt.token')

    const res = await request(app)
      .post('/auth/admin-login')
      .send({ email: 'valdo@vgr.com.br', password: 'teste' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ jwt: 'fake.jwt.token' })
    expect(mockedService.authenticateAdmin).toHaveBeenCalledWith('valdo@vgr.com.br', 'teste')
  })

  it('returns 401 when the service rejects the credentials', async () => {
    const { HttpError } = jest.requireActual('@shared/errors/http-error')
    mockedService.authenticateAdmin.mockRejectedValue(new HttpError(401, 'Invalid email or password'))

    const res = await request(app)
      .post('/auth/admin-login')
      .send({ email: 'valdo@vgr.com.br', password: 'wrong' })

    expect(res.status).toBe(401)
  })

  it('returns 422 with the standardized error body for a missing password', async () => {
    const res = await request(app)
      .post('/auth/admin-login')
      .send({ email: 'valdo@vgr.com.br' })

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
  })

  it('does not require an Authorization header (route is public, outside /api)', async () => {
    mockedService.authenticateAdmin.mockResolvedValue('fake.jwt.token')

    const res = await request(app)
      .post('/auth/admin-login')
      .send({ email: 'valdo@vgr.com.br', password: 'teste' })

    expect(res.status).not.toBe(401)
  })
})
