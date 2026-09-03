import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/media/media.service'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/media/media.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedService = service as jest.Mocked<typeof service>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

const USER_ID = 3
const PUBLIC_ID = '9b2b6c1a-0000-4000-8000-000000000002'
const BLOCKED = {
  publicId: PUBLIC_ID,
  status: 'blocked',
  blockedReasonCode: 'illegal_content',
  blockedNote: null,
  blockedAt: '2026-09-02T10:00:00.000Z',
}
const AVAILABLE = {
  publicId: PUBLIC_ID,
  status: 'available',
  blockedReasonCode: null,
  blockedNote: null,
  blockedAt: null,
}

/** Grants by "interface:privilege" — blocking a media is `reports` UPDATE
 *  (165), NOT media_evidence (which only READS). */
function grant(pairs: string[]): void {
  mockedPrivileges.userHasPrivilege.mockImplementation(
    async (_userId, interfaceKey, privilege) => pairs.includes(`${interfaceKey}:${privilege}`)
  )
}

describe('/api/media/:publicId/block and /unblock (B2 — decisions 162/163/165)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    grant(['reports:UPDATE'])
    token = signSession(USER_ID, 1)
    mockedService.blockMedia.mockResolvedValue(BLOCKED as any)
    mockedService.unblockMedia.mockResolvedValue(AVAILABLE as any)
  })

  describe('POST /api/media/:publicId/block', () => {
    it('blocks with reports UPDATE, routes the acting user, audits state_change/media/publicId with the reason', async () => {
      const res = await request(app)
        .post(`/api/media/${PUBLIC_ID}/block`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'illegal_content' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual(BLOCKED)
      expect(mockedService.blockMedia).toHaveBeenCalledWith(
        PUBLIC_ID,
        { reasonCode: 'illegal_content' },
        USER_ID
      )
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'media',
        PUBLIC_ID,
        { action: 'block', reasonCode: 'illegal_content', note: null }
      )
    })

    it('carries the note into the service and the audit summary', async () => {
      await request(app)
        .post(`/api/media/${PUBLIC_ID}/block`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'other', note: 'face of a minor' })

      expect(mockedService.blockMedia).toHaveBeenCalledWith(
        PUBLIC_ID,
        { reasonCode: 'other', note: 'face of a minor' },
        USER_ID
      )
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'media',
        PUBLIC_ID,
        { action: 'block', reasonCode: 'other', note: 'face of a minor' }
      )
    })

    it('422 with field codes for `other` without a note / unknown code — service never runs', async () => {
      const noNote = await request(app)
        .post(`/api/media/${PUBLIC_ID}/block`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'other' })
      expect(noNote.status).toBe(422)
      expect(noNote.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      expect(noNote.body.fields).toEqual([
        expect.objectContaining({ field: 'note', code: 'REQUIRED' }),
      ])

      const badCode = await request(app)
        .post(`/api/media/${PUBLIC_ID}/block`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'rude' })
      expect(badCode.status).toBe(422)
      expect(badCode.body.fields).toEqual([
        expect.objectContaining({ field: 'reasonCode', code: 'INVALID_OPTION' }),
      ])

      expect(mockedService.blockMedia).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('403 with media_evidence VIEW only (reading is not moderating, 165); no audit row', async () => {
      grant(['media_evidence:VIEW', 'media_original:VIEW', 'reports:VIEW'])
      const res = await request(app)
        .post(`/api/media/${PUBLIC_ID}/block`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(403)
      expect(mockedService.blockMedia).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('404 (missing / not available) passes through and is not audited', async () => {
      mockedService.blockMedia.mockRejectedValueOnce(
        new HttpError(404, 'Media not found', undefined, ErrorCodes.NOT_FOUND)
      )
      const res = await request(app)
        .post(`/api/media/${PUBLIC_ID}/block`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(404)
      expect(res.body.code).toBe(ErrorCodes.NOT_FOUND)
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/media/:publicId/unblock', () => {
    it('reverts under the SAME rule: one human with reports UPDATE + a reason, audited (162)', async () => {
      const res = await request(app)
        .post(`/api/media/${PUBLIC_ID}/unblock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'other', note: 'appeal upheld' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual(AVAILABLE)
      expect(mockedService.unblockMedia).toHaveBeenCalledWith(
        PUBLIC_ID,
        { reasonCode: 'other', note: 'appeal upheld' },
        USER_ID
      )
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'media',
        PUBLIC_ID,
        { action: 'unblock', reasonCode: 'other', note: 'appeal upheld' }
      )
    })

    it('the reason for reverting is mandatory too', async () => {
      const res = await request(app)
        .post(`/api/media/${PUBLIC_ID}/unblock`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
      expect(res.status).toBe(422)
      expect(mockedService.unblockMedia).not.toHaveBeenCalled()
    })

    it('403 without reports UPDATE', async () => {
      grant(['media_evidence:VIEW'])
      const res = await request(app)
        .post(`/api/media/${PUBLIC_ID}/unblock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(403)
      expect(mockedService.unblockMedia).not.toHaveBeenCalled()
    })

    it('404 when not blocked passes through, not audited', async () => {
      mockedService.unblockMedia.mockRejectedValueOnce(
        new HttpError(404, 'Media not found', undefined, ErrorCodes.NOT_FOUND)
      )
      const res = await request(app)
        .post(`/api/media/${PUBLIC_ID}/unblock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(404)
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })
  })

  it('the moderation routes do not shadow the M3 read route (GET /:publicId/:variant still streams)', async () => {
    grant(['media_evidence:VIEW'])
    mockedService.openVariantForPanel.mockResolvedValue({
      data: Buffer.from('img'),
      mime: 'image/webp',
    })
    const res = await request(app)
      .get(`/api/media/${PUBLIC_ID}/thumb`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(mockedService.openVariantForPanel).toHaveBeenCalledWith(PUBLIC_ID, 'thumb')
  })

  it('no token is a 401', async () => {
    const res = await request(app).post(`/api/media/${PUBLIC_ID}/block`).send({ reasonCode: 'spam' })
    expect(res.status).toBe(401)
  })
})
