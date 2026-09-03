import * as repository from '@modules/messaging/chat.repository'
import * as service from '@modules/messaging/chat.service'
import {
  ChatMessageRow,
  ChatParticipantRow,
  ChatReportRow,
  ChatThreadRow,
} from '@modules/messaging/chat.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { getRiskTier } from '@shared/risk/risk-tier'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

jest.mock('@modules/messaging/chat.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const REPORT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const MSG_KEY = '9b2b6c1a-0000-4000-8000-000000000002'
const IP = '10.0.0.1'

const OWNER_BY_ACCOUNT = { accountId: 42, clientKey: null, ip: IP }
const OWNER_BY_KEY = { accountId: null, clientKey: REPORT_KEY, ip: IP }
const HELPER = { accountId: 8, clientKey: null, ip: IP }
const OTHER_HELPER = { accountId: 9, clientKey: null, ip: IP }
const STRANGER = { accountId: null, clientKey: 'not-the-key', ip: IP }

const REPORTER_TOKEN = 'a1'.repeat(16)
const HELPER_TOKEN = 'b2'.repeat(16)

function report(overrides: Partial<ChatReportRow> = {}): ChatReportRow {
  return {
    id: 7,
    clientKey: REPORT_KEY,
    reporterAccountId: 42,
    anonymous: false,
    category: 'assault',
    status: 'open',
    hidden: false,
    frozen: false,
    purged: false,
    ...overrides,
  }
}

function thread(overrides: Partial<ChatThreadRow> = {}): ChatThreadRow {
  return {
    id: 3,
    reportId: 7,
    helperAccountId: 8,
    helpOfferId: 11,
    createdAt: new Date('2026-09-03T10:00:00Z'),
    offerAnonymous: false,
    helperDisplayName: 'Ana',
    lastMessageAt: new Date('2026-09-03T10:37:42Z'),
    ...overrides,
  }
}

function participants(): ChatParticipantRow[] {
  return [
    {
      id: 31,
      threadId: 3,
      role: 'reporter',
      accountId: 42,
      clientKey: REPORT_KEY,
      token: REPORTER_TOKEN,
      lastReadMessageId: null,
    },
    {
      id: 32,
      threadId: 3,
      role: 'helper',
      accountId: 8,
      clientKey: null,
      token: HELPER_TOKEN,
      lastReadMessageId: 100,
    },
  ]
}

function message(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 101,
    threadId: 3,
    senderParticipantId: 32,
    clientKey: MSG_KEY,
    text: 'estou a duas quadras, posso ir agora',
    purged: false,
    createdAt: new Date('2026-09-03T10:37:42Z'),
    ...overrides,
  }
}

const INPUT = { clientKey: MSG_KEY, text: 'estou a duas quadras, posso ir agora' }

describe('chat.service (C1 — decisions 54, 169-177)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    delete process.env.CHAT_MAX_LENGTH
    delete process.env.CHAT_RATE_PER_MINUTE
    mockedTier.mockResolvedValue('low')
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
    mockedRepository.findReportForChat.mockResolvedValue(report())
    mockedRepository.findOfferByAccount.mockImplementation(async (_reportId, accountId) =>
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
    mockedRepository.listMessages.mockResolvedValue([])
    mockedRepository.countRecentMessages.mockResolvedValue(0)
    mockedRepository.countUnread.mockResolvedValue(0)
    mockedRepository.advanceLastRead.mockResolvedValue()
  })

  describe('eligibility (decisions 169/20/55)', () => {
    it('the owner by ACCOUNT lists every thread of the report, seen from the reporter side', async () => {
      const { threads } = await service.listThreads(7, OWNER_BY_ACCOUNT)
      expect(threads).toHaveLength(1)
      expect(threads[0].me.role).toBe('reporter')
      expect(threads[0].other.role).toBe('helper')
      expect(mockedRepository.listThreadsByReport).toHaveBeenCalledWith(7)
    })

    it('the anonymous owner lists by presenting the clientKey (134 pattern)', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ reporterAccountId: null }))
      const { threads } = await service.listThreads(7, OWNER_BY_KEY)
      expect(threads).toHaveLength(1)
      expect(threads[0].me.participantToken).toBe(REPORTER_TOKEN)
    })

    it('a helper with an identified offer sees ONLY their own thread', async () => {
      const { threads } = await service.listThreads(7, HELPER)
      expect(threads).toHaveLength(1)
      expect(threads[0].me.role).toBe('helper')
      expect(threads[0].other.role).toBe('reporter')
      expect(mockedRepository.listThreadsByReport).not.toHaveBeenCalled()
      expect(mockedRepository.findThreadByReportAndHelper).toHaveBeenCalledWith(7, 8)
    })

    it('a helper with an offer but no thread yet gets an empty list, not 404', async () => {
      mockedRepository.findThreadByReportAndHelper.mockResolvedValue(null)
      await expect(service.listThreads(7, HELPER)).resolves.toEqual({ threads: [] })
    })

    it('an account WITHOUT an offer on the report gets 404 — existence is information', async () => {
      await expect(service.listThreads(7, OTHER_HELPER)).rejects.toMatchObject({ statusCode: 404 })
      await expect(service.postToReport(7, INPUT, OTHER_HELPER)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('a stranger (no account, wrong key) gets 404', async () => {
      await expect(service.listThreads(7, STRANGER)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('a helper WITHOUT an account can never open a thread (169) — 404, no offer lookup by NULL', async () => {
      const anonymousHelper = { accountId: null, clientKey: null, ip: IP }
      await expect(service.postToReport(7, INPUT, anonymousHelper)).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(mockedRepository.findOfferByAccount).not.toHaveBeenCalled()
      expect(mockedRepository.insertThreadWithParticipants).not.toHaveBeenCalled()
    })

    it('the owner cannot open a thread with themself (20): the report route answers 403', async () => {
      await expect(service.postToReport(7, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 403,
      })
      await expect(service.postToReport(7, INPUT, OWNER_BY_KEY)).rejects.toMatchObject({
        statusCode: 403,
      })
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
    })

    it('another helper of the same report gets 404 on a thread that is not theirs (55)', async () => {
      await expect(service.getMessages(3, { after: 0, limit: 50 }, OTHER_HELPER)).rejects.toMatchObject(
        { statusCode: 404 }
      )
      await expect(service.postToThread(3, INPUT, OTHER_HELPER)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('a purged report is gone for the chat too (25/131)', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ purged: true }))
      await expect(service.listThreads(7, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 404,
      })
      await expect(service.getMessages(3, { after: 0, limit: 50 }, HELPER)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('a missing thread is 404', async () => {
      mockedRepository.findThreadById.mockResolvedValue(null)
      await expect(service.getMessages(99, { after: 0, limit: 50 }, HELPER)).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('mask (decision 170 — never more permissive than the offer)', () => {
    it('an anonymous helper shows no name to the owner', async () => {
      mockedRepository.listThreadsByReport.mockResolvedValue([thread({ offerAnonymous: true })])
      const { threads } = await service.listThreads(7, OWNER_BY_ACCOUNT)
      expect(threads[0].other).toEqual({
        participantToken: HELPER_TOKEN,
        role: 'helper',
        displayName: null,
      })
    })

    it('an identified helper on a low-tier case shows the display name', async () => {
      const { threads } = await service.listThreads(7, OWNER_BY_ACCOUNT)
      expect(threads[0].other.displayName).toBe('Ana')
    })

    it('high tier masks even a willing helper (40/60)', async () => {
      mockedTier.mockResolvedValue('high')
      const { threads } = await service.listThreads(7, OWNER_BY_ACCOUNT)
      expect(threads[0].other.displayName).toBeNull()
    })

    it('the reporter NEVER shows a name — to the helper, nor to themself', async () => {
      const helperSide = await service.listThreads(7, HELPER)
      expect(helperSide.threads[0].other).toEqual({
        participantToken: REPORTER_TOKEN,
        role: 'reporter',
        displayName: null,
      })
      const ownerSide = await service.listThreads(7, OWNER_BY_ACCOUNT)
      expect(ownerSide.threads[0].me.displayName).toBeNull()
    })
  })

  describe('participant tokens (spec MaskedIdentity)', () => {
    it('are 32 hex chars, distinct per participant and never reused across two threads of the same helper', async () => {
      mockedRepository.findThreadByReportAndHelper.mockResolvedValue(null)
      mockedRepository.insertThreadWithParticipants.mockResolvedValueOnce(3).mockResolvedValueOnce(4)
      mockedRepository.findThreadById.mockResolvedValue(thread())

      await service.postToReport(7, INPUT, HELPER)
      mockedRepository.findReportForChat.mockResolvedValue(report({ id: 8, clientKey: 'k2' }))
      await service.postToReport(8, { ...INPUT, clientKey: '9b2b6c1a-0000-4000-8000-000000000003' }, HELPER)

      const calls = mockedRepository.insertThreadWithParticipants.mock.calls
      expect(calls).toHaveLength(2)
      const tokens = calls.flatMap(([input]) => [input.reporter.token, input.helper.token])
      for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{32}$/)
      expect(new Set(tokens).size).toBe(4)
    })

    it('the reporter participant keeps the internal link — account AND clientKey — for the platform (23/60)', async () => {
      mockedRepository.findThreadByReportAndHelper.mockResolvedValue(null)
      await service.postToReport(7, INPUT, HELPER)
      const [input] = mockedRepository.insertThreadWithParticipants.mock.calls[0]
      expect(input).toMatchObject({
        reportId: 7,
        helperAccountId: 8,
        helpOfferId: 11,
        reporter: { accountId: 42, clientKey: REPORT_KEY },
        helper: { accountId: 8 },
      })
    })
  })

  describe('Legal Gate (decision 176 — before any write)', () => {
    it('thread creation is refused with 451 and nothing is inserted', async () => {
      mockedRepository.findThreadByReportAndHelper.mockResolvedValue(null)
      mockedGate.mockRejectedValue(new HttpError(451, 'blocked', undefined, 'LEGAL_BLOCKED'))

      await expect(service.postToReport(7, INPUT, HELPER)).rejects.toMatchObject({ statusCode: 451 })

      expect(mockedRepository.insertThreadWithParticipants).not.toHaveBeenCalled()
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
    })

    it('each post consumes chat.masked with the actor reference; blocked -> 451 and no insert', async () => {
      await service.postToThread(3, INPUT, HELPER)
      expect(mockedGate).toHaveBeenCalledWith('chat.masked', { userRef: '8', ip: IP })

      mockedGate.mockRejectedValue(new HttpError(451, 'blocked', undefined, 'LEGAL_BLOCKED'))
      await expect(service.postToThread(3, INPUT, OWNER_BY_KEY)).rejects.toMatchObject({
        statusCode: 451,
      })
      expect(mockedRepository.insertMessage).toHaveBeenCalledTimes(1)
    })

    it('an anonymous reporter is gated without a userRef', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ reporterAccountId: null }))
      await service.postToThread(3, INPUT, OWNER_BY_KEY)
      expect(mockedGate).toHaveBeenCalledWith('chat.masked', { userRef: undefined, ip: IP })
    })

    it('reads are not gated', async () => {
      await service.listThreads(7, OWNER_BY_ACCOUNT)
      await service.getMessages(3, { after: 0, limit: 50 }, HELPER)
      expect(mockedGate).not.toHaveBeenCalled()
    })
  })

  describe('delivery and idempotency (decision 172)', () => {
    it('the helper FIRST message creates the thread (173) and answers 201 semantics', async () => {
      mockedRepository.findThreadByReportAndHelper.mockResolvedValue(null)
      const result = await service.postToReport(7, INPUT, HELPER)
      expect(result).toEqual({
        threadId: 3,
        replayed: false,
        message: {
          messageId: 101,
          clientKey: MSG_KEY,
          sender: HELPER_TOKEN,
          mine: true,
          text: INPUT.text,
          purged: false,
          createdAt: '2026-09-03T10:37:00.000Z',
        },
      })
      expect(mockedRepository.insertMessage).toHaveBeenCalledWith({
        threadId: 3,
        senderParticipantId: 32,
        clientKey: MSG_KEY,
        text: INPUT.text,
      })
    })

    it('a replay by clientKey returns the SAME message with replayed: true — before re-judging', async () => {
      mockedRepository.findMessageByClientKey.mockResolvedValue(message())
      const result = await service.postToThread(3, INPUT, HELPER)
      expect(result.replayed).toBe(true)
      expect(result.message.messageId).toBe(101)
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
      expect(mockedGate).not.toHaveBeenCalled()
    })

    it('two replays racing on the unique clientKey resolve to the winner', async () => {
      mockedRepository.insertMessage.mockResolvedValue(null)
      mockedRepository.findMessageByClientKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(message())
      const result = await service.postToThread(3, INPUT, HELPER)
      expect(result).toMatchObject({ replayed: true, message: { messageId: 101 } })
    })

    it('two first messages racing on the unique (report, helper) resolve to the winner thread', async () => {
      mockedRepository.findThreadByReportAndHelper
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(thread({ id: 5 }))
      mockedRepository.insertThreadWithParticipants.mockResolvedValue(null)
      const result = await service.postToReport(7, INPUT, HELPER)
      expect(result.threadId).toBe(5)
      expect(mockedRepository.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: 5 })
      )
    })

    it('GET pages ascending by id from the cursor and passes after/limit to the repository', async () => {
      mockedRepository.listMessages.mockResolvedValue([
        message({ id: 101 }),
        message({ id: 102, senderParticipantId: 31, text: 'obrigado' }),
      ])
      const page = await service.getMessages(3, { after: 100, limit: 20 }, HELPER)
      expect(mockedRepository.listMessages).toHaveBeenCalledWith(3, 100, 20)
      expect(page.messages.map((m) => m.messageId)).toEqual([101, 102])
      expect(page.messages[0]).toMatchObject({ sender: HELPER_TOKEN, mine: true })
      expect(page.messages[1]).toMatchObject({ sender: REPORTER_TOKEN, mine: false })
      expect(page).toMatchObject({ threadId: 3, closed: false, tier: 'low' })
    })

    it('a purged message is served with text null and purged true (131 skeleton)', async () => {
      mockedRepository.listMessages.mockResolvedValue([message({ text: null, purged: true })])
      const page = await service.getMessages(3, { after: 0, limit: 50 }, HELPER)
      expect(page.messages[0]).toMatchObject({ text: null, purged: true })
    })
  })

  describe('text rules (decision 171 / 177)', () => {
    it('a contact in the text is refused with 422 CONTACT_NOT_ALLOWED pointing at the excerpt — nothing written', async () => {
      const err = await service
        .postToThread(3, { clientKey: MSG_KEY, text: 'me chama no 11 91234-5678' }, HELPER)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HttpError)
      expect(err).toMatchObject({
        statusCode: 422,
        code: 'CONTACT_NOT_ALLOWED',
        fields: [
          {
            field: 'text',
            code: 'CONTACT_NOT_ALLOWED',
            params: { kind: 'phone', match: '11 91234-5678' },
          },
        ],
      })
      expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
      expect(mockedGate).not.toHaveBeenCalled()
    })

    it('text longer than CHAT_MAX_LENGTH is 422 TOO_LONG on the text field', async () => {
      process.env.CHAT_MAX_LENGTH = '20'
      await expect(
        service.postToThread(3, { clientKey: MSG_KEY, text: 'x'.repeat(21) }, HELPER)
      ).rejects.toMatchObject({
        statusCode: 422,
        fields: [{ field: 'text', code: 'TOO_LONG', params: { max: '20' } }],
      })
      await expect(
        service.postToThread(3, { clientKey: MSG_KEY, text: 'x'.repeat(20) }, HELPER)
      ).resolves.toMatchObject({ replayed: false })
    })

    it('text is trimmed and an empty text is 422', async () => {
      await expect(
        service.postToThread(3, { clientKey: MSG_KEY, text: '   ' }, HELPER)
      ).rejects.toMatchObject({ statusCode: 422, fields: [{ field: 'text' }] })
      await service.postToThread(3, { clientKey: MSG_KEY, text: '  oi  ' }, HELPER)
      expect(mockedRepository.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'oi' })
      )
    })
  })

  describe('lifecycle (decision 173)', () => {
    it('a RESOLVED case closes writes with 409 CHAT_CLOSED — reads stay', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ status: 'resolved' }))
      await expect(service.postToThread(3, INPUT, HELPER)).rejects.toMatchObject({
        statusCode: 409,
        code: 'CHAT_CLOSED',
      })
      mockedRepository.findThreadByReportAndHelper.mockResolvedValue(null)
      await expect(service.postToReport(7, INPUT, HELPER)).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(mockedRepository.insertThreadWithParticipants).not.toHaveBeenCalled()

      const page = await service.getMessages(3, { after: 0, limit: 50 }, HELPER)
      expect(page.closed).toBe(true)
      const { threads } = await service.listThreads(7, OWNER_BY_ACCOUNT)
      expect(threads[0].closed).toBe(true)
    })

    it('a HIDDEN case (162) closes writes the same way', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ hidden: true }))
      await expect(service.postToThread(3, INPUT, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 409,
        code: 'CHAT_CLOSED',
      })
      const page = await service.getMessages(3, { after: 0, limit: 50 }, OWNER_BY_ACCOUNT)
      expect(page.closed).toBe(true)
    })

    it('a FROZEN case (141) keeps reading AND writing', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ frozen: true }))
      await expect(service.postToThread(3, INPUT, HELPER)).resolves.toMatchObject({
        replayed: false,
      })
      const page = await service.getMessages(3, { after: 0, limit: 50 }, HELPER)
      expect(page.closed).toBe(false)
    })

    it('a replay on a closed case still answers the same message (idempotency first)', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ status: 'resolved' }))
      mockedRepository.findMessageByClientKey.mockResolvedValue(message())
      await expect(service.postToThread(3, INPUT, HELPER)).resolves.toMatchObject({
        replayed: true,
      })
    })
  })

  describe('rate limit (decision 177 — counted in the DB)', () => {
    it('the 31st message inside 60 s is 429 RATE_LIMITED; the 30th passes', async () => {
      mockedRepository.countRecentMessages.mockResolvedValue(29)
      await expect(service.postToThread(3, INPUT, HELPER)).resolves.toMatchObject({
        replayed: false,
      })
      expect(mockedRepository.countRecentMessages).toHaveBeenCalledWith(32, 60)

      mockedRepository.countRecentMessages.mockResolvedValue(30)
      await expect(service.postToThread(3, INPUT, HELPER)).rejects.toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMITED',
      })
      expect(mockedRepository.insertMessage).toHaveBeenCalledTimes(1)
    })

    it('the limit is configuration (CHAT_RATE_PER_MINUTE)', async () => {
      process.env.CHAT_RATE_PER_MINUTE = '2'
      mockedRepository.countRecentMessages.mockResolvedValue(2)
      await expect(service.postToThread(3, INPUT, HELPER)).rejects.toMatchObject({
        statusCode: 429,
      })
    })
  })

  describe('timestamps and read pointer (decision 174)', () => {
    it('createdAt is degraded by tier: hour bucket on high, minute on low', async () => {
      mockedRepository.listMessages.mockResolvedValue([message()])
      mockedTier.mockResolvedValue('high')
      let page = await service.getMessages(3, { after: 0, limit: 50 }, HELPER)
      expect(page.messages[0].createdAt).toBe('2026-09-03T10:00:00.000Z')

      mockedTier.mockResolvedValue('low')
      page = await service.getMessages(3, { after: 0, limit: 50 }, HELPER)
      expect(page.messages[0].createdAt).toBe('2026-09-03T10:37:00.000Z')
    })

    it('lastMessageAt on the summary is degraded too', async () => {
      mockedTier.mockResolvedValue('medium')
      const { threads } = await service.listThreads(7, OWNER_BY_ACCOUNT)
      expect(threads[0].lastMessageAt).toBe('2026-09-03T10:30:00.000Z')
    })

    it('the GET advances the caller OWN pointer to the max served id — and only then', async () => {
      mockedRepository.listMessages.mockResolvedValue([message({ id: 101 }), message({ id: 105 })])
      await service.getMessages(3, { after: 0, limit: 50 }, OWNER_BY_ACCOUNT)
      expect(mockedRepository.advanceLastRead).toHaveBeenCalledWith(31, 105)

      mockedRepository.advanceLastRead.mockClear()
      mockedRepository.listMessages.mockResolvedValue([])
      await service.getMessages(3, { after: 105, limit: 50 }, OWNER_BY_ACCOUNT)
      expect(mockedRepository.advanceLastRead).not.toHaveBeenCalled()
    })

    it('unreadCount comes from the caller pointer and no read pointer of the OTHER side is served', async () => {
      mockedRepository.countUnread.mockResolvedValue(4)
      const { threads } = await service.listThreads(7, HELPER)
      expect(threads[0].unreadCount).toBe(4)
      expect(mockedRepository.countUnread).toHaveBeenCalledWith(3, 32, 100)
      expect(JSON.stringify(threads)).not.toContain('lastRead')
    })
  })

  describe('accountability (decision 23 — anonymous actors only)', () => {
    it('an anonymous reporter post leaves the trail with thread and message ids', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ reporterAccountId: null }))
      mockedRepository.insertMessage.mockResolvedValue(message({ senderParticipantId: 31 }))
      await service.postToThread(3, INPUT, OWNER_BY_KEY)
      expect(mockedAccountability).toHaveBeenCalledWith('chat.message', IP, {
        threadId: 3,
        messageId: 101,
      })
    })

    it('a helper post and an identified owner post write no trail', async () => {
      await service.postToThread(3, INPUT, HELPER)
      await service.postToThread(3, INPUT, OWNER_BY_ACCOUNT)
      expect(mockedAccountability).not.toHaveBeenCalled()
    })

    it('an accountability failure is logged, never blocks the message (123)', async () => {
      const spy = jest.spyOn(logger, 'error').mockImplementation(() => undefined)
      mockedRepository.findReportForChat.mockResolvedValue(report({ reporterAccountId: null }))
      mockedAccountability.mockRejectedValue(new Error('db down'))
      await expect(service.postToThread(3, INPUT, OWNER_BY_KEY)).resolves.toMatchObject({
        replayed: false,
      })
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe('nothing identifying leaves the API (decisions 170/23)', () => {
    const forbidden = [/accountId/i, /helperAccountId/i, /reporterAccountId/i, /@[a-z0-9-]+\./i]

    it('thread summaries', async () => {
      // The join knew a name shaped like an e-mail; the helper chose
      // anonymity, so nothing of it may leak.
      mockedRepository.listThreadsByReport.mockResolvedValue([
        thread({ offerAnonymous: true, helperDisplayName: 'ana@example.com' }),
      ])
      const serialized = JSON.stringify(await service.listThreads(7, OWNER_BY_KEY))
      for (const pattern of forbidden) expect(serialized).not.toMatch(pattern)
      expect(serialized).not.toContain(REPORT_KEY)
    })

    it('message pages and post results', async () => {
      mockedRepository.listMessages.mockResolvedValue([message()])
      const page = JSON.stringify(await service.getMessages(3, { after: 0, limit: 50 }, HELPER))
      const posted = JSON.stringify(await service.postToThread(3, INPUT, HELPER))
      for (const serialized of [page, posted]) {
        for (const pattern of forbidden) expect(serialized).not.toMatch(pattern)
        expect(serialized).not.toContain(REPORT_KEY)
        // The message's own clientKey (idempotency, 172) IS served; the
        // report's bearer secret never is.
        expect(serialized).toContain(MSG_KEY)
      }
    })
  })
})
