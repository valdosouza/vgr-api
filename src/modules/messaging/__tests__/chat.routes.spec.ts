import request from 'supertest'
import app from '../../../app'
import * as repository from '@modules/messaging/chat.repository'
import * as accountRepository from '@modules/accounts/account.repository'
import {
  ChatMessageRow,
  ChatParticipantRow,
  ChatReportRow,
  ChatThreadRow,
} from '@modules/messaging/chat.interface'
import { signAppAccessToken } from '@shared/auth/app-session'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { getRiskTier } from '@shared/risk/risk-tier'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/messaging/chat.repository')
jest.mock('@modules/accounts/account.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAccounts = accountRepository as jest.Mocked<typeof accountRepository>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const REPORT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const MSG_KEY = '9b2b6c1a-0000-4000-8000-000000000002'
const REPORTER_TOKEN = 'a1'.repeat(16)
const HELPER_TOKEN = 'b2'.repeat(16)

function account(id: number) {
  return {
    id,
    displayName: 'Ana',
    email: 'ana@example.com',
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    passwordHash: null,
    jurisdiction: 'BR',
    consentVersion: 'v1',
    sessionVersion: 1,
    failedLoginCount: 0,
    totpSecret: null,
    totpEnabled: false,
    active: true,
  } as any
}

const helperToken = () => `Bearer ${signAppAccessToken(8, 1)}`
const ownerToken = () => `Bearer ${signAppAccessToken(42, 1)}`
const strangerToken = () => `Bearer ${signAppAccessToken(9, 1)}`

function report(overrides: Partial<ChatReportRow> = {}): ChatReportRow {
  return {
    id: 7,
    clientKey: REPORT_KEY,
    reporterAccountId: 42,
    category: 'assault',
    status: 'open',
    hidden: false,
    frozen: false,
    purged: false,
    ...overrides,
  }
}

function thread(): ChatThreadRow {
  return {
    id: 3,
    reportId: 7,
    helperAccountId: 8,
    helpOfferId: 11,
    createdAt: new Date('2026-09-03T10:00:00Z'),
    offerAnonymous: false,
    helperDisplayName: 'Ana',
    lastMessageAt: new Date('2026-09-03T10:37:42Z'),
  }
}

function participants(): ChatParticipantRow[] {
  return [
    { id: 31, threadId: 3, role: 'reporter', accountId: 42, clientKey: REPORT_KEY, token: REPORTER_TOKEN, lastReadMessageId: null },
    { id: 32, threadId: 3, role: 'helper', accountId: 8, clientKey: null, token: HELPER_TOKEN, lastReadMessageId: null },
  ]
}

function message(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 101,
    threadId: 3,
    senderParticipantId: 32,
    clientKey: MSG_KEY,
    text: 'estou a duas quadras',
    purged: false,
    createdAt: new Date('2026-09-03T10:37:42Z'),
    ...overrides,
  }
}

const BODY = { clientKey: MSG_KEY, text: 'estou a duas quadras' }

describe('/app-chat routes (C1 — decisions 54, 169-177)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    delete process.env.CHAT_MAX_LENGTH
    delete process.env.CHAT_RATE_PER_MINUTE
    jest.resetAllMocks()
    mockedAccounts.findAccountById.mockImplementation(async (id) => account(id))
    mockedTier.mockResolvedValue('low')
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
    mockedRepository.findReportForChat.mockResolvedValue(report())
    mockedRepository.findOfferByAccount.mockImplementation(async (_r, accountId) =>
      accountId === 8
        ? { id: 11, helperAccountId: 8, anonymous: false, helperDisplayName: 'Ana' }
        : null
    )
    mockedRepository.findThreadById.mockResolvedValue(thread())
    mockedRepository.findThreadByReportAndHelper.mockResolvedValue(thread())
    mockedRepository.listThreadsByReport.mockResolvedValue([thread()])
    mockedRepository.findParticipants.mockResolvedValue(participants())
    mockedRepository.findMessageByClientKey.mockResolvedValue(null)
    mockedRepository.insertMessage.mockResolvedValue(message())
    mockedRepository.insertThreadWithParticipants.mockResolvedValue(3)
    mockedRepository.listMessages.mockResolvedValue([message()])
    mockedRepository.countRecentMessages.mockResolvedValue(0)
    mockedRepository.countUnread.mockResolvedValue(2)
    mockedRepository.advanceLastRead.mockResolvedValue()
  })

  describe('plane and headers', () => {
    it('the anonymous owner lists threads by the x-client-key HEADER (never the URL)', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ reporterAccountId: null }))

      const res = await request(app).get('/app-chat/7/threads').set('x-client-key', REPORT_KEY)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        threads: [
          {
            threadId: 3,
            reportId: 7,
            me: { participantToken: REPORTER_TOKEN, role: 'reporter', displayName: null },
            other: { participantToken: HELPER_TOKEN, role: 'helper', displayName: 'Ana' },
            lastMessageAt: '2026-09-03T10:37:00.000Z',
            unreadCount: 2,
            closed: false,
          },
        ],
      })

      const viaUrl = await request(app).get(`/app-chat/7/threads?clientKey=${REPORT_KEY}`)
      expect(viaUrl.status).toBe(404)
    })

    it('a PRESENT but invalid app token is 401, never downgraded to anonymous', async () => {
      const res = await request(app).get('/app-chat/7/threads').set('Authorization', 'Bearer forged')
      expect(res.status).toBe(401)
    })

    it('is never mounted under the panel plane (/api)', async () => {
      const res = await request(app).get('/api/app-chat/7/threads').set('x-client-key', REPORT_KEY)
      expect(res.status).toBe(401)
      expect(mockedRepository.findReportForChat).not.toHaveBeenCalled()
    })

    it('a bad id is 400 INVALID_ID on every route', async () => {
      const a = await request(app).get('/app-chat/abc/threads')
      const b = await request(app).post('/app-chat/abc/messages').send(BODY)
      const c = await request(app).get('/app-chat/threads/abc/messages')
      const d = await request(app).post('/app-chat/threads/abc/messages').send(BODY)
      for (const res of [a, b, c, d]) {
        expect(res.status).toBe(400)
        expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
      }
    })

    it('append-only: there is no PUT nor DELETE (177)', async () => {
      const put = await request(app).put('/app-chat/threads/3/messages').set('Authorization', helperToken()).send(BODY)
      const del = await request(app).delete('/app-chat/threads/3/messages/101').set('Authorization', helperToken())
      expect(put.status).toBe(404)
      expect(del.status).toBe(404)
    })
  })

  describe('POST /app-chat/:reportId/messages (helper entry — 169/173)', () => {
    it('201 with the thread and the masked message on the first accept', async () => {
      mockedRepository.findThreadByReportAndHelper.mockResolvedValue(null)

      const res = await request(app)
        .post('/app-chat/7/messages')
        .set('Authorization', helperToken())
        .send(BODY)

      expect(res.status).toBe(201)
      expect(res.body).toEqual({
        threadId: 3,
        message: {
          messageId: 101,
          clientKey: MSG_KEY,
          sender: HELPER_TOKEN,
          mine: true,
          text: 'estou a duas quadras',
          purged: false,
          createdAt: '2026-09-03T10:37:00.000Z',
        },
      })
      expect(mockedRepository.insertThreadWithParticipants).toHaveBeenCalledTimes(1)
    })

    it('200 with replayed: true on an offline-queue replay (172)', async () => {
      mockedRepository.findMessageByClientKey.mockResolvedValue(message())
      const res = await request(app)
        .post('/app-chat/7/messages')
        .set('Authorization', helperToken())
        .send(BODY)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ threadId: 3, replayed: true, message: { messageId: 101 } })
    })

    it('the owner calling the helper route is 403 (they post into the thread)', async () => {
      const byAccount = await request(app)
        .post('/app-chat/7/messages')
        .set('Authorization', ownerToken())
        .send(BODY)
      const byKey = await request(app)
        .post('/app-chat/7/messages')
        .set('x-client-key', REPORT_KEY)
        .send(BODY)
      expect(byAccount.status).toBe(403)
      expect(byAccount.body.code).toBe(ErrorCodes.FORBIDDEN)
      expect(byKey.status).toBe(403)
    })

    it('a helper without an offer, and a helper without an account, are 404 (169)', async () => {
      const noOffer = await request(app)
        .post('/app-chat/7/messages')
        .set('Authorization', strangerToken())
        .send(BODY)
      const noAccount = await request(app).post('/app-chat/7/messages').send(BODY)
      expect(noOffer.status).toBe(404)
      expect(noAccount.status).toBe(404)
    })

    it('409 CHAT_CLOSED on a resolved case (173)', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ status: 'resolved' }))
      const res = await request(app)
        .post('/app-chat/7/messages')
        .set('Authorization', helperToken())
        .send(BODY)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe(ErrorCodes.CHAT_CLOSED)
    })
  })

  describe('POST /app-chat/threads/:threadId/messages (participants)', () => {
    it('the anonymous owner posts by x-client-key and leaves the accountability trail (23)', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ reporterAccountId: null }))
      mockedRepository.insertMessage.mockResolvedValue(message({ senderParticipantId: 31 }))

      const res = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('x-client-key', REPORT_KEY)
        .send(BODY)

      expect(res.status).toBe(201)
      expect(res.body.message).toMatchObject({ sender: REPORTER_TOKEN, mine: true })
      expect(mockedAccountability).toHaveBeenCalledWith('chat.message', expect.any(String), {
        threadId: 3,
        messageId: 101,
      })
    })

    it('another helper of the same case is 404 (55), a stranger too', async () => {
      const other = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', strangerToken())
        .send(BODY)
      const stranger = await request(app).post('/app-chat/threads/3/messages').send(BODY)
      expect(other.status).toBe(404)
      expect(stranger.status).toBe(404)
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
    })

    it('422 CONTACT_NOT_ALLOWED with the field contract of decision 83 (171)', async () => {
      const res = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())
        .send({ clientKey: MSG_KEY, text: 'me chama no telegram @ana' })

      expect(res.status).toBe(422)
      expect(res.body).toEqual({
        error: 'Direct contact is not allowed in the chat',
        code: 'CONTACT_NOT_ALLOWED',
        fields: [
          {
            field: 'text',
            message: 'Direct contact is not allowed in the chat',
            code: 'CONTACT_NOT_ALLOWED',
            params: { kind: 'messenger', match: 'telegram @a' },
          },
        ],
      })
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
    })

    it('422 TOO_LONG past CHAT_MAX_LENGTH with params.max', async () => {
      process.env.CHAT_MAX_LENGTH = '10'
      const res = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())
        .send({ clientKey: MSG_KEY, text: 'x'.repeat(11) })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      expect(res.body.fields).toEqual([
        expect.objectContaining({ field: 'text', code: 'TOO_LONG', params: { max: '10' } }),
      ])
    })

    it('422 on an invalid clientKey and on a missing text', async () => {
      const badKey = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())
        .send({ clientKey: 'not-a-uuid', text: 'oi' })
      expect(badKey.status).toBe(422)
      expect(badKey.body.fields).toEqual([
        expect.objectContaining({ field: 'clientKey', code: 'INVALID_FORMAT' }),
      ])

      const noText = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())
        .send({ clientKey: MSG_KEY })
      expect(noText.status).toBe(422)
      expect(noText.body.fields).toEqual([expect.objectContaining({ field: 'text', code: 'REQUIRED' })])
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
    })

    it('451 LEGAL_BLOCKED when the jurisdiction blocks chat.masked (176)', async () => {
      mockedGate.mockRejectedValue(
        new HttpError(451, 'Blocked', undefined, ErrorCodes.LEGAL_BLOCKED, {
          capability: 'chat.masked',
          reason: 'no_control',
        })
      )
      const res = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())
        .send(BODY)
      expect(res.status).toBe(451)
      expect(res.body.code).toBe(ErrorCodes.LEGAL_BLOCKED)
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
    })

    it('429 RATE_LIMITED at the 31st message in 60 s (177)', async () => {
      mockedRepository.countRecentMessages.mockResolvedValue(30)
      const res = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())
        .send(BODY)
      expect(res.status).toBe(429)
      expect(res.body.code).toBe(ErrorCodes.RATE_LIMITED)
    })

    it('409 CHAT_CLOSED on a hidden case (162/173)', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ hidden: true }))
      const res = await request(app)
        .post('/app-chat/threads/3/messages')
        .set('Authorization', ownerToken())
        .send(BODY)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe(ErrorCodes.CHAT_CLOSED)
    })
  })

  describe('GET /app-chat/threads/:threadId/messages', () => {
    it('serves the page with defaults after=0 limit=50, degraded timestamps, and advances the read pointer', async () => {
      const res = await request(app)
        .get('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        threadId: 3,
        closed: false,
        tier: 'low',
        messages: [
          {
            messageId: 101,
            clientKey: MSG_KEY,
            sender: HELPER_TOKEN,
            mine: true,
            text: 'estou a duas quadras',
            purged: false,
            createdAt: '2026-09-03T10:37:00.000Z',
          },
        ],
      })
      expect(mockedRepository.listMessages).toHaveBeenCalledWith(3, 0, 50)
      expect(mockedRepository.advanceLastRead).toHaveBeenCalledWith(32, 101)
      expect(mockedGate).not.toHaveBeenCalled()
    })

    it('honours after and limit; rejects non-numeric after and limit > 200 with field codes', async () => {
      await request(app)
        .get('/app-chat/threads/3/messages?after=100&limit=20')
        .set('x-client-key', REPORT_KEY)
      expect(mockedRepository.listMessages).toHaveBeenCalledWith(3, 100, 20)

      const badAfter = await request(app)
        .get('/app-chat/threads/3/messages?after=abc')
        .set('x-client-key', REPORT_KEY)
      expect(badAfter.status).toBe(422)
      expect(badAfter.body.fields[0].field).toBe('after')

      const bigLimit = await request(app)
        .get('/app-chat/threads/3/messages?limit=201')
        .set('x-client-key', REPORT_KEY)
      expect(bigLimit.status).toBe(422)
      expect(bigLimit.body.fields[0]).toMatchObject({ field: 'limit', code: 'TOO_LONG' })
    })

    it('reads stay open on a resolved case (closed: true) and are never gated', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ status: 'resolved' }))
      const res = await request(app)
        .get('/app-chat/threads/3/messages')
        .set('x-client-key', REPORT_KEY)
      expect(res.status).toBe(200)
      expect(res.body.closed).toBe(true)
      expect(mockedGate).not.toHaveBeenCalled()
    })

    it('a non-participant is 404', async () => {
      const res = await request(app)
        .get('/app-chat/threads/3/messages')
        .set('Authorization', strangerToken())
      expect(res.status).toBe(404)
      expect(mockedRepository.advanceLastRead).not.toHaveBeenCalled()
    })

    it('no response ever carries an accountId, the report clientKey or an e-mail', async () => {
      const list = await request(app).get('/app-chat/7/threads').set('Authorization', helperToken())
      const page = await request(app)
        .get('/app-chat/threads/3/messages')
        .set('Authorization', helperToken())
      for (const res of [list, page]) {
        const serialized = JSON.stringify(res.body)
        expect(serialized).not.toMatch(/accountId/i)
        expect(serialized).not.toContain(REPORT_KEY)
        expect(serialized).not.toMatch(/@[a-z0-9-]+\./i)
      }
    })
  })
})
