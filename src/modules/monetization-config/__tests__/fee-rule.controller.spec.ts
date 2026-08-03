import jwt from 'jsonwebtoken'
import * as aclStore from '@shared/acl/privilege-store'
import request from 'supertest'
import app from '../../../app'
import * as service from '../fee-rule.service'

jest.mock('../fee-rule.service')

const mockedService = service as jest.Mocked<typeof service>

jest.mock('@shared/acl/privilege-store')
const mockedAcl = aclStore as jest.Mocked<typeof aclStore>

function tokenFor(role: string): string {
  return jwt.sign({ userId: role === 'admin' ? 1 : 2, role }, process.env.JWT_SECRET ?? 'test-secret')
}

describe('GET /api/monetization-config', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId === 1)
  })

  it('returns 200 with every configured rule for an admin caller', async () => {
    mockedService.listFeeRules.mockResolvedValue([
      { category: null, feePercent: 10, paymentModeAllowed: ['intermediated', 'peer_to_peer'] },
      { category: 'trafficking', feePercent: 5, paymentModeAllowed: ['intermediated'] },
    ])

    const res = await request(app)
      .get('/api/monetization-config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .get('/api/monetization-config')
      .set('Authorization', `Bearer ${tokenFor('reporter')}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/monetization-config/:category', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId === 1)
  })

  it('returns 200 with the effective rule (falling back to the global default) for an admin caller', async () => {
    mockedService.getFeeRule.mockResolvedValue({
      category: 'traffic',
      feePercent: 10,
      paymentModeAllowed: ['intermediated', 'peer_to_peer'],
    })

    const res = await request(app)
      .get('/api/monetization-config/traffic')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)

    expect(res.status).toBe(200)
    expect(res.body.data.feePercent).toBe(10)
    expect(mockedService.getFeeRule).toHaveBeenCalledWith('traffic')
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .get('/api/monetization-config/traffic')
      .set('Authorization', `Bearer ${tokenFor('reporter')}`)

    expect(res.status).toBe(403)
  })
})

describe('PUT /api/monetization-config/:category', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId === 1)
  })

  it('returns 200 with the updated rule when an admin sets a Category-specific rule', async () => {
    mockedService.setFeeRule.mockResolvedValue(undefined)

    const res = await request(app)
      .put('/api/monetization-config/trafficking')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ feePercent: 5, paymentModeAllowed: ['intermediated'] })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ category: 'trafficking', feePercent: 5, paymentModeAllowed: ['intermediated'] })
    expect(mockedService.setFeeRule).toHaveBeenCalledWith('trafficking', 5, ['intermediated'])
  })

  it('sets the global default rule when :category is the literal "global"', async () => {
    mockedService.setFeeRule.mockResolvedValue(undefined)

    const res = await request(app)
      .put('/api/monetization-config/global')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ feePercent: 10, paymentModeAllowed: ['intermediated', 'peer_to_peer'] })

    expect(res.status).toBe(200)
    expect(mockedService.setFeeRule).toHaveBeenCalledWith(null, 10, ['intermediated', 'peer_to_peer'])
  })

  it('returns 403 when a non-admin caller attempts the request', async () => {
    const res = await request(app)
      .put('/api/monetization-config/trafficking')
      .set('Authorization', `Bearer ${tokenFor('reporter')}`)
      .send({ feePercent: 5, paymentModeAllowed: ['intermediated'] })

    expect(res.status).toBe(403)
    expect(mockedService.setFeeRule).not.toHaveBeenCalled()
  })

  it('returns 422 with the standardized error body for an invalid paymentModeAllowed value', async () => {
    const res = await request(app)
      .put('/api/monetization-config/trafficking')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ feePercent: 5, paymentModeAllowed: ['crypto'] })

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
  })
})
