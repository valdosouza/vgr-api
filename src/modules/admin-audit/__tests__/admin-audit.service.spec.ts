import * as repository from '@modules/admin-audit/admin-audit.repository'
import * as service from '@modules/admin-audit/admin-audit.service'
import { AuditEntryRow, AuditListRow } from '@modules/admin-audit/admin-audit.interface'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/admin-audit/admin-audit.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

const DAY_MS = 24 * 60 * 60 * 1000
const CREATED = new Date('2026-08-20T10:00:00.000Z')

function listRow(overrides: Partial<AuditListRow> = {}): AuditListRow {
  return {
    id: 9,
    actorId: 3,
    actorName: 'Ana',
    action: 'grant',
    entity: 'user_privileges',
    entityId: '7',
    summary: '{"granted":["reports"]}',
    createdAt: CREATED,
    ...overrides,
  }
}

function entryRow(overrides: Partial<AuditEntryRow> = {}): AuditEntryRow {
  return { ...listRow(), ip: '203.0.113.5', ...overrides }
}

/** Business rules of the trail READ (B5 — decisions 116/165/166): the
 *  summary is served as stored (parsed when it is JSON, never
 *  re-interpreted); `ip` leaves ONLY with a single entry; the service
 *  itself never writes. */
describe('admin-audit.service (decisions 116/165/166)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('listAuditEntries', () => {
    it('passes the filters, page and pageSize to the repository and wraps the page', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({ rows: [listRow()], total: 1 })

      const page = await service.listAuditEntries({
        page: 2,
        pageSize: 25,
        actorId: 3,
        action: 'grant',
        entity: 'user_privileges',
        entityId: '7',
      })

      expect(mockedRepository.listAuditEntries).toHaveBeenCalledWith(
        { actorId: 3, action: 'grant', entity: 'user_privileges', entityId: '7' },
        2,
        25
      )
      expect(page).toEqual({
        items: [
          {
            id: 9,
            actorId: 3,
            actorName: 'Ana',
            action: 'grant',
            entity: 'user_privileges',
            entityId: '7',
            summary: { granted: ['reports'] },
            createdAt: '2026-08-20T10:00:00.000Z',
          },
        ],
        page: 2,
        pageSize: 25,
        total: 1,
      })
    })

    it('date-only bounds: from at midnight UTC inclusive, to at the NEXT midnight exclusive (B1 semantics)', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({ rows: [], total: 0 })

      await service.listAuditEntries({ page: 1, pageSize: 50, from: '2026-08-01', to: '2026-08-31' })

      expect(mockedRepository.listAuditEntries).toHaveBeenCalledWith(
        {
          createdFrom: new Date('2026-08-01T00:00:00.000Z'),
          createdTo: new Date(new Date('2026-08-31T00:00:00.000Z').getTime() + DAY_MS),
          createdToExclusive: true,
        },
        1,
        50
      )
    })

    it('date-time bounds are the instants themselves, `to` inclusive', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({ rows: [], total: 0 })

      await service.listAuditEntries({
        page: 1,
        pageSize: 50,
        from: '2026-08-01T08:00:00.000Z',
        to: '2026-08-31T18:30:00.000Z',
      })

      expect(mockedRepository.listAuditEntries).toHaveBeenCalledWith(
        {
          createdFrom: new Date('2026-08-01T08:00:00.000Z'),
          createdTo: new Date('2026-08-31T18:30:00.000Z'),
          createdToExclusive: false,
        },
        1,
        50
      )
    })

    it('a summary that is not JSON is served as the raw string — never re-interpreted', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({
        rows: [listRow({ summary: 'legacy free text' })],
        total: 1,
      })

      const page = await service.listAuditEntries({ page: 1, pageSize: 50 })

      expect(page.items[0].summary).toBe('legacy free text')
    })

    it('a null summary stays null; a JSON scalar stays the parsed scalar', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({
        rows: [listRow({ id: 2, summary: null }), listRow({ id: 1, summary: '"[redacted]"' })],
        total: 2,
      })

      const page = await service.listAuditEntries({ page: 1, pageSize: 50 })

      expect(page.items[0].summary).toBeNull()
      expect(page.items[1].summary).toBe('[redacted]')
    })

    it('a stored summary is served as stored — the redacted marker is not undone', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({
        rows: [listRow({ summary: '{"password":"[redacted]","name":"x"}' })],
        total: 1,
      })

      const page = await service.listAuditEntries({ page: 1, pageSize: 50 })

      expect(page.items[0].summary).toEqual({ password: '[redacted]', name: 'x' })
    })

    it('a deleted actor still names its rows; a missing name serializes as null', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({
        rows: [listRow({ actorName: null })],
        total: 1,
      })

      const page = await service.listAuditEntries({ page: 1, pageSize: 50 })

      expect(page.items[0].actorId).toBe(3)
      expect(page.items[0].actorName).toBeNull()
    })

    it('the list item has NO ip key — even if a repository row carried one', async () => {
      mockedRepository.listAuditEntries.mockResolvedValue({
        rows: [entryRow() as AuditListRow],
        total: 1,
      })

      const page = await service.listAuditEntries({ page: 1, pageSize: 50 })

      expect(JSON.parse(JSON.stringify(page.items[0]))).not.toHaveProperty('ip')
    })
  })

  describe('getAuditEntry', () => {
    it('serves the full entry with ip and the parsed summary', async () => {
      mockedRepository.findAuditEntryById.mockResolvedValue(entryRow())

      const entry = await service.getAuditEntry(9)

      expect(mockedRepository.findAuditEntryById).toHaveBeenCalledWith(9)
      expect(entry).toEqual({
        id: 9,
        actorId: 3,
        actorName: 'Ana',
        action: 'grant',
        entity: 'user_privileges',
        entityId: '7',
        summary: { granted: ['reports'] },
        ip: '203.0.113.5',
        createdAt: '2026-08-20T10:00:00.000Z',
      })
    })

    it('a null ip is served as null', async () => {
      mockedRepository.findAuditEntryById.mockResolvedValue(entryRow({ ip: null }))
      expect((await service.getAuditEntry(9)).ip).toBeNull()
    })

    it('404 NOT_FOUND when the entry does not exist', async () => {
      mockedRepository.findAuditEntryById.mockResolvedValue(null)

      await expect(service.getAuditEntry(404)).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      })
      await expect(service.getAuditEntry(404)).rejects.toBeInstanceOf(HttpError)
    })
  })

  describe('getAuditFacets', () => {
    it('passes the distinct values through', async () => {
      mockedRepository.listAuditFacets.mockResolvedValue({ actions: ['grant'], entities: ['user'] })
      expect(await service.getAuditFacets()).toEqual({ actions: ['grant'], entities: ['user'] })
    })
  })

  it('exposes only read operations — the trail is append-only (116)', () => {
    expect(Object.keys(service).sort()).toEqual(['getAuditEntry', 'getAuditFacets', 'listAuditEntries'])
  })
})
