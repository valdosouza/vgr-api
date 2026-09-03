import * as repository from '@modules/messaging/chat.repository'
import * as service from '@modules/messaging/chat-admin.service'
import {
  ChatMessageRow,
  ChatParticipantRow,
  ChatReportRow,
  ChatThreadRow,
} from '@modules/messaging/chat.interface'
import { getRiskTier } from '@shared/risk/risk-tier'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/messaging/chat.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

const REPORT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const REPORTER_TOKEN = 'a1'.repeat(16)
const HELPER_TOKEN = 'b2'.repeat(16)
const QUERY = { limit: 200 }

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

function participants(reporterAccountId: number | null = 42): ChatParticipantRow[] {
  return [
    {
      id: 31,
      threadId: 3,
      role: 'reporter',
      accountId: reporterAccountId,
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
    clientKey: '9b2b6c1a-0000-4000-8000-000000000002',
    text: 'estou a duas quadras, posso ir agora',
    purged: false,
    createdAt: new Date('2026-09-03T10:37:42Z'),
    ...overrides,
  }
}

describe('chat-admin.service — audited panel read (C3, decisions 175/23/60/160)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.findReportForChat.mockResolvedValue(report())
    mockedRepository.listThreadsByReport.mockResolvedValue([thread()])
    mockedRepository.findParticipants.mockResolvedValue(participants())
    mockedRepository.findAccountDisplayName.mockResolvedValue('Bia')
    mockedRepository.listMessages.mockResolvedValue([message()])
  })

  it('404 NOT_FOUND when the report is missing or deleted', async () => {
    mockedRepository.findReportForChat.mockResolvedValue(null)
    await expect(service.getReportChatEvidence(7, QUERY)).rejects.toMatchObject({
      statusCode: 404,
      code: ErrorCodes.NOT_FOUND,
    })
    expect(mockedRepository.listThreadsByReport).not.toHaveBeenCalled()
  })

  it('a report with no threads answers { threads: [] } with the tier (existence is already known to a reports VIEW holder)', async () => {
    mockedTier.mockResolvedValue('high')
    mockedRepository.listThreadsByReport.mockResolvedValue([])

    const result = await service.getReportChatEvidence(7, QUERY)

    expect(result).toEqual({ reportId: 7, tier: 'high', threads: [] })
    expect(mockedTier).toHaveBeenCalledWith('assault')
  })

  it('serves the thread shape: threadId, helpOfferId, createdAt, closed, participants, messages, hasMore', async () => {
    const result = await service.getReportChatEvidence(7, QUERY)

    expect(result.threads).toHaveLength(1)
    expect(result.threads[0]).toEqual({
      threadId: 3,
      helpOfferId: 11,
      createdAt: '2026-09-03T10:00:00.000Z',
      closed: false,
      participants: [
        {
          role: 'reporter',
          participantToken: REPORTER_TOKEN,
          accountId: 42,
          displayName: 'Bia',
          anonymousChoice: false,
        },
        {
          role: 'helper',
          participantToken: HELPER_TOKEN,
          accountId: 8,
          displayName: 'Ana',
          anonymousChoice: false,
        },
      ],
      messages: [
        {
          messageId: 101,
          sender: HELPER_TOKEN,
          text: 'estou a duas quadras, posso ir agora',
          purged: false,
          createdAt: '2026-09-03T10:37:42.000Z',
        },
      ],
      hasMore: false,
    })
  })

  describe('identity per anonymity x role (decisions 23/60/160)', () => {
    it('identified reporter: accountId + displayName looked up, anonymousChoice false', async () => {
      const result = await service.getReportChatEvidence(7, QUERY)
      const reporter = result.threads[0].participants.find((p) => p.role === 'reporter')!
      expect(reporter).toEqual({
        role: 'reporter',
        participantToken: REPORTER_TOKEN,
        accountId: 42,
        displayName: 'Bia',
        anonymousChoice: false,
      })
      expect(mockedRepository.findAccountDisplayName).toHaveBeenCalledWith(42)
    })

    it('anonymous reporter WITH an account: accountId null, displayName null, anonymousChoice true — the account is not even looked up', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ anonymous: true }))

      const result = await service.getReportChatEvidence(7, QUERY)

      const reporter = result.threads[0].participants.find((p) => p.role === 'reporter')!
      expect(reporter).toEqual({
        role: 'reporter',
        participantToken: REPORTER_TOKEN,
        accountId: null,
        displayName: null,
        anonymousChoice: true,
      })
      expect(mockedRepository.findAccountDisplayName).not.toHaveBeenCalled()
    })

    it('anonymous reporter WITHOUT an account (clientKey only): null identity, and the clientKey never appears', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(
        report({ anonymous: true, reporterAccountId: null })
      )
      mockedRepository.findParticipants.mockResolvedValue(participants(null))

      const result = await service.getReportChatEvidence(7, QUERY)

      const reporter = result.threads[0].participants.find((p) => p.role === 'reporter')!
      expect(reporter.accountId).toBeNull()
      expect(reporter.displayName).toBeNull()
      const json = JSON.stringify(result)
      expect(json).not.toContain(REPORT_KEY)
      expect(json).not.toContain('clientKey')
      expect(json).not.toContain('reporterAccountId')
    })

    it('a reporter flagged identified but without an account (defensive) serves null identity', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ reporterAccountId: null }))
      mockedRepository.findParticipants.mockResolvedValue(participants(null))

      const result = await service.getReportChatEvidence(7, QUERY)

      const reporter = result.threads[0].participants.find((p) => p.role === 'reporter')!
      expect(reporter.accountId).toBeNull()
      expect(reporter.displayName).toBeNull()
      expect(mockedRepository.findAccountDisplayName).not.toHaveBeenCalled()
    })

    it('the helper is ALWAYS identifiable to the platform (60): accountId + displayName even when the offer chose anonymity, anonymousChoice true', async () => {
      mockedRepository.listThreadsByReport.mockResolvedValue([thread({ offerAnonymous: true })])

      const result = await service.getReportChatEvidence(7, QUERY)

      const helper = result.threads[0].participants.find((p) => p.role === 'helper')!
      expect(helper).toEqual({
        role: 'helper',
        participantToken: HELPER_TOKEN,
        accountId: 8,
        displayName: 'Ana',
        anonymousChoice: true,
      })
    })

    it('high tier does not mask the helper for the panel (the panel is the platform, 60)', async () => {
      mockedTier.mockResolvedValue('high')
      const result = await service.getReportChatEvidence(7, QUERY)
      const helper = result.threads[0].participants.find((p) => p.role === 'helper')!
      expect(helper.displayName).toBe('Ana')
      expect(helper.accountId).toBe(8)
      expect(result.tier).toBe('high')
    })
  })

  describe('messages', () => {
    it('timestamps are EXACT even in high tier (the panel is not a participant; 41 protects reporter-side correlation)', async () => {
      mockedTier.mockResolvedValue('high')
      mockedRepository.listMessages.mockResolvedValue([
        message({ id: 101, createdAt: new Date('2026-09-03T10:37:42.000Z') }),
      ])
      const result = await service.getReportChatEvidence(7, QUERY)
      expect(result.threads[0].messages[0].createdAt).toBe('2026-09-03T10:37:42.000Z')
    })

    it('sender is the participantToken; messages keep the ascending order served by the repository from id 0', async () => {
      mockedRepository.listMessages.mockResolvedValue([
        message({ id: 101, senderParticipantId: 32 }),
        message({ id: 102, senderParticipantId: 31, text: 'ok, cuidado' }),
      ])

      const result = await service.getReportChatEvidence(7, QUERY)

      expect(result.threads[0].messages.map((m) => [m.messageId, m.sender])).toEqual([
        [101, HELPER_TOKEN],
        [102, REPORTER_TOKEN],
      ])
      expect(mockedRepository.listMessages).toHaveBeenCalledWith(3, 0, 201)
    })

    it('purged text is served as stored: text null, purged true — a purged report is NOT a 404', async () => {
      mockedRepository.findReportForChat.mockResolvedValue(report({ purged: true }))
      mockedRepository.listMessages.mockResolvedValue([message({ text: null, purged: true })])

      const result = await service.getReportChatEvidence(7, QUERY)

      expect(result.threads[0].messages[0]).toMatchObject({ text: null, purged: true })
    })

    it('caps per thread at limit and flags hasMore when the repository returned one extra row', async () => {
      mockedRepository.listMessages.mockResolvedValue([
        message({ id: 1 }),
        message({ id: 2 }),
        message({ id: 3 }),
      ])

      const result = await service.getReportChatEvidence(7, { limit: 2 })

      expect(mockedRepository.listMessages).toHaveBeenCalledWith(3, 0, 3)
      expect(result.threads[0].messages.map((m) => m.messageId)).toEqual([1, 2])
      expect(result.threads[0].hasMore).toBe(true)
    })

    it('hasMore is false when the page fits the limit exactly', async () => {
      mockedRepository.listMessages.mockResolvedValue([message({ id: 1 }), message({ id: 2 })])
      const result = await service.getReportChatEvidence(7, { limit: 2 })
      expect(result.threads[0].messages).toHaveLength(2)
      expect(result.threads[0].hasMore).toBe(false)
    })
  })

  describe('closed derived from the case (173)', () => {
    it.each([
      ['resolved', report({ status: 'resolved' }), true],
      ['hidden', report({ hidden: true }), true],
      ['frozen (keeps going)', report({ frozen: true }), false],
      ['open', report(), false],
    ])('%s -> closed %s', async (_label, row, expected) => {
      mockedRepository.findReportForChat.mockResolvedValue(row)
      const result = await service.getReportChatEvidence(7, QUERY)
      expect(result.threads[0].closed).toBe(expected)
    })
  })

  it('READ ONLY (175): never touches the read pointer nor any write function', async () => {
    await service.getReportChatEvidence(7, QUERY)
    expect(mockedRepository.advanceLastRead).not.toHaveBeenCalled()
    expect(mockedRepository.insertMessage).not.toHaveBeenCalled()
    expect(mockedRepository.insertThreadWithParticipants).not.toHaveBeenCalled()
  })

  it('serves every thread of the case, each with its own participants and messages', async () => {
    mockedRepository.listThreadsByReport.mockResolvedValue([
      thread({ id: 3 }),
      thread({ id: 4, helperAccountId: 9, helpOfferId: 12, helperDisplayName: 'Caio' }),
    ])
    mockedRepository.findParticipants.mockImplementation(async (threadId) =>
      participants().map((p) => ({ ...p, threadId }))
    )
    mockedRepository.listMessages.mockImplementation(async (threadId) =>
      threadId === 3 ? [message({ id: 1 })] : []
    )

    const result = await service.getReportChatEvidence(7, QUERY)

    expect(result.threads.map((t) => t.threadId)).toEqual([3, 4])
    expect(result.threads[0].messages).toHaveLength(1)
    expect(result.threads[1].messages).toHaveLength(0)
    expect(result.threads[1].participants[1].displayName).toBe('Caio')
    expect(mockedRepository.findParticipants).toHaveBeenCalledWith(3)
    expect(mockedRepository.findParticipants).toHaveBeenCalledWith(4)
  })

  it('a thread missing a mask row is a server error, not a silent hole', async () => {
    mockedRepository.findParticipants.mockResolvedValue([participants()[0]])
    const attempt = service.getReportChatEvidence(7, QUERY)
    await expect(attempt).rejects.toThrow()
    await expect(attempt).rejects.not.toBeInstanceOf(HttpError)
  })
})
