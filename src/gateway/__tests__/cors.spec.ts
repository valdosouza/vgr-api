import request from 'supertest'
import app from '../../app'

/**
 * CORS contract for the web targets (decision 115; platform priority
 * "Web + Android first"). Found by the first manual end-to-end run on
 * 2026-09-06: the preflight answered 204 but did not list `x-client-key`
 * in Access-Control-Allow-Headers, so the browser refused every
 * owner/participant call (report detail, resolve, rating, chat) from the
 * Flutter web build — the anonymous owner's bearer secret (decision 134)
 * travels as a custom header and is therefore preflighted.
 */
describe('CORS preflight', () => {
  it('allows the x-client-key header the anonymous owner sends (decision 134)', async () => {
    const res = await request(app)
      .options('/app-reports/1')
      .set('Origin', 'http://localhost:5001')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-client-key')

    expect(res.status).toBe(204)
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase()
    expect(allowed.split(',').map((h) => h.trim())).toEqual(
      expect.arrayContaining(['content-type', 'authorization', 'x-client-key'])
    )
  })

  it('answers a wildcard origin outside production', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5001')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })
})
