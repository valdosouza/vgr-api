import request from 'supertest'
import app from '../../../app'
import * as statsService from '@modules/reports/reports-stats.service'
import * as adminService from '@modules/reports/reports-admin.service'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import { InterfaceKeys } from '@shared/acl/privileges'
import { ReportStats } from '@modules/reports/reports.interface'

jest.mock('@modules/reports/reports-stats.service')
jest.mock('@modules/reports/reports-admin.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedStats = statsService as jest.Mocked<typeof statsService>
const mockedAdmin = adminService as jest.Mocked<typeof adminService>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

function grant(keys: Record<string, boolean>): void {
  mockedPrivileges.userHasPrivilege.mockImplementation(
    async (_userId, interfaceKey) => keys[interfaceKey] === true
  )
}

const sample: ReportStats = {
  range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', granularity: 'day' },
  totals: {
    reports: 12,
    open: 5,
    resolved: 7,
    anonymous: '<5',
    identified: 8,
    frozen: '<5',
    hidden: 0,
    expired: '<5',
    purged: '<5',
    withMedia: 6,
  },
  byPeriod: [{ period: '2026-08-03', reports: 12 }],
  byCategory: [{ category: 'assault', tier: 'low', reports: 12 }],
  bySubject: [{ subject: 'adult', reports: 12 }],
  byStatus: [
    { status: 'open', reports: 5 },
    { status: 'resolved', reports: 7 },
  ],
  byTier: [
    { tier: 'low', reports: 12 },
    { tier: 'medium', reports: 0 },
    { tier: 'high', reports: 0 },
  ],
  moderation: { hiddenByReason: [], blockedMediaByReason: [] },
}

describe('GET /api/reports/stats (B4 — decisions 164/165)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    token = signSession(3, 1)
  })

  it('the interface key is report_stats (165)', () => {
    expect(InterfaceKeys.REPORT_STATS).toBe('report_stats')
  })

  it('serves the aggregates with the report_stats VIEW grant alone and writes NO audit row', async () => {
    grant({ report_stats: true })
    mockedStats.getReportStats.mockResolvedValue(sample)

    const res = await request(app)
      .get('/api/reports/stats?from=2026-08-01&to=2026-08-31&granularity=week')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(sample)
    expect(mockedStats.getReportStats).toHaveBeenCalledWith({
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'week',
    })
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('granularity defaults to day; from/to are left to the service defaults', async () => {
    grant({ report_stats: true })
    mockedStats.getReportStats.mockResolvedValue(sample)

    const res = await request(app).get('/api/reports/stats').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(mockedStats.getReportStats).toHaveBeenCalledWith({ granularity: 'day' })
  })

  it('is NOT swallowed by /:id — the detail handler never runs (no 400 INVALID_ID, no audit)', async () => {
    grant({ report_stats: true })
    mockedStats.getReportStats.mockResolvedValue(sample)

    const res = await request(app).get('/api/reports/stats').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(mockedAdmin.getReportPanelDetail).not.toHaveBeenCalled()
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('422 with field codes on a bad query (decision 83) — service never runs', async () => {
    grant({ report_stats: true })

    const res = await request(app)
      .get('/api/reports/stats?from=yesterday&to=2026-13-45T99:00:00Z&granularity=hour')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
    const fields = Object.fromEntries(res.body.fields.map((f: any) => [f.field, f.code]))
    expect(fields).toEqual({
      from: FieldErrorCodes.INVALID_FORMAT,
      to: FieldErrorCodes.INVALID_FORMAT,
      granularity: FieldErrorCodes.INVALID_OPTION,
    })
    expect(mockedStats.getReportStats).not.toHaveBeenCalled()
  })

  it('a range rejected by the service (from > to / > 366 days) passes through as the 422 envelope', async () => {
    grant({ report_stats: true })
    mockedStats.getReportStats.mockRejectedValue(
      new HttpError(
        422,
        'Validation failed',
        [{ field: 'to', message: 'Range too long', code: FieldErrorCodes.TOO_LONG, params: { max: '366' } }],
        ErrorCodes.VALIDATION_FAILED
      )
    )

    const res = await request(app)
      .get('/api/reports/stats?from=2025-01-01&to=2026-06-01')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body).toEqual({
      error: 'Validation failed',
      code: ErrorCodes.VALIDATION_FAILED,
      fields: [{ field: 'to', message: 'Range too long', code: 'TOO_LONG', params: { max: '366' } }],
    })
  })

  it('403 with only the reports grant — report_stats is its own interface (165)', async () => {
    grant({ reports: true })
    const res = await request(app).get('/api/reports/stats').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(mockedStats.getReportStats).not.toHaveBeenCalled()
    expect(mockedAdmin.getReportPanelDetail).not.toHaveBeenCalled()
  })

  it('401 without a token', async () => {
    const res = await request(app).get('/api/reports/stats')
    expect(res.status).toBe(401)
  })
})
