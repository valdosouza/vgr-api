import request from 'supertest'
import pool from '@shared/db/connection'
import app from '../app'
import { pingDatabase } from '@shared/db/health'

jest.mock('@shared/db/connection', () => ({ __esModule: true, default: { query: jest.fn() } }))

const query = pool.query as unknown as jest.Mock

/** Decision 245: the external monitor reads /health every minute, so it
 *  has to report a database that does not answer. */
describe('/health', () => {
  beforeEach(() => query.mockReset())

  it('answers 200 when the database answers', async () => {
    query.mockResolvedValue([[{ 1: 1 }]])
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('answers 503 when the database refuses', async () => {
    query.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const res = await request(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'unavailable', ts: expect.any(String) })
  })

  it('gives up on a database that hangs instead of waiting for the pool', async () => {
    query.mockReturnValue(new Promise(() => {}))
    const started = Date.now()
    expect(await pingDatabase(50)).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
