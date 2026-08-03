import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../../app'
import * as service from '../risk-config.service'

jest.mock('../risk-config.service')

const mockedService = service as jest.Mocked<typeof service>

function tokenFor(role: string): string {
  return jwt.sign({ userId: 1, role }, process.env.JWT_SECRET ?? 'test-secret')
}

describe('GET /api/risk-config', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns 200 with every configured tier for an admin caller', async () => {
    mockedService.listRiskTierConfigs.mockResolvedValue([
      { category: 'trafficking', tier: 'high' },
    ])

    const res = await request(app)
      .get('/api/risk-config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: [{ category: 'trafficking', tier: 'high' }] })
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .get('/api/risk-config')
      .set('Authorization', `Bearer ${tokenFor('reporter')}`)

    expect(res.status).toBe(403)
  })
})

describe('PUT /api/risk-config/:category', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns 200 with the updated tier when an admin makes the request', async () => {
    mockedService.setRiskTier.mockResolvedValue(undefined)

    const res = await request(app)
      .put('/api/risk-config/trafficking')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ tier: 'high' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: { category: 'trafficking', tier: 'high' } })
    expect(mockedService.setRiskTier).toHaveBeenCalledWith('trafficking', 'high')
  })

  it('returns 403 when a non-admin caller attempts the request', async () => {
    const res = await request(app)
      .put('/api/risk-config/trafficking')
      .set('Authorization', `Bearer ${tokenFor('reporter')}`)
      .send({ tier: 'high' })

    expect(res.status).toBe(403)
    expect(mockedService.setRiskTier).not.toHaveBeenCalled()
  })

  it('returns 422 with the standardized error body for an invalid tier value', async () => {
    const res = await request(app)
      .put('/api/risk-config/trafficking')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ tier: 'extreme' })

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
  })
})
