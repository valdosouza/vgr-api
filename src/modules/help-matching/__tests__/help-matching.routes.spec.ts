import request from 'supertest'
import app from '../../../app'
import * as repository from '@modules/help-matching/help-matching.repository'
import { getRiskTier } from '@shared/risk/risk-tier'

jest.mock('@modules/help-matching/help-matching.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

describe('GET /app-feed (R2 — anonymous, criterion 2)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.listNearby.mockResolvedValue([])
    mockedTier.mockResolvedValue('low')
  })

  it('answers an anonymous request — no token, defaults applied', async () => {
    const res = await request(app).get('/app-feed').query({ lat: -23.55, lng: -46.63 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], page: 1, hasMore: false, order: 'recency' })
    expect(mockedRepository.listNearby).toHaveBeenCalledWith(
      { lat: -23.55, lng: -46.63 },
      'recency',
      0,
      21
    )
  })

  it('rejects an out-of-range latitude with field codes', async () => {
    const res = await request(app).get('/app-feed').query({ lat: 91, lng: 0 })
    expect(res.status).toBe(422)
    expect(res.body.fields.some((f: any) => f.field === 'lat')).toBe(true)
  })

  it('accepts the relevance ordering (decision 21)', async () => {
    const res = await request(app)
      .get('/app-feed')
      .query({ lat: -23.55, lng: -46.63, order: 'relevance', page: 2 })
    expect(res.status).toBe(200)
    expect(mockedRepository.listNearby).toHaveBeenCalledWith(
      { lat: -23.55, lng: -46.63 },
      'relevance',
      20,
      21
    )
  })
})
