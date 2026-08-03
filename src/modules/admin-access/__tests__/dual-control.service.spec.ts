import * as repository from '@modules/admin-access/dual-control.repository'
import {
  createDualControlRequest,
  listDualControlRequests,
  addApproval,
} from '@modules/admin-access/dual-control.service'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/admin-access/dual-control.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('dual-control.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('creates a pending request with an empty approverIds set', async () => {
    mockedRepository.createRequest.mockResolvedValue({
      id: 1,
      accountabilityLogEntryId: 99,
      legalBasis: 'Court order #123',
      approverIds: [],
      status: 'pending',
      createdAt: new Date('2026-01-01'),
    })

    const req = await createDualControlRequest(99, 'Court order #123')

    expect(req.status).toBe('pending')
    expect(req.approverIds).toEqual([])
    expect(mockedRepository.createRequest).toHaveBeenCalledWith(99, 'Court order #123')
  })

  it('lists dual-control requests', async () => {
    mockedRepository.findAllRequests.mockResolvedValue([
      { id: 1, accountabilityLogEntryId: 99, legalBasis: 'x', approverIds: [], status: 'pending', createdAt: new Date() },
    ])

    const rows = await listDualControlRequests()

    expect(rows).toHaveLength(1)
  })

  it('stays pending after the first approval', async () => {
    mockedRepository.findRequestById.mockResolvedValue({
      id: 1,
      accountabilityLogEntryId: 99,
      legalBasis: 'Court order #123',
      approverIds: [],
      status: 'pending',
      createdAt: new Date('2026-01-01'),
    })
    mockedRepository.persistApproval.mockResolvedValue(undefined)

    const req = await addApproval(1, 'admin-a')

    expect(req.status).toBe('pending')
    expect(req.approverIds).toEqual(['admin-a'])
    expect(mockedRepository.persistApproval).toHaveBeenCalledWith(1, ['admin-a'], 'pending')
  })

  it('grants access only after the second distinct approval (decision 45)', async () => {
    mockedRepository.findRequestById.mockResolvedValue({
      id: 1,
      accountabilityLogEntryId: 99,
      legalBasis: 'Court order #123',
      approverIds: ['admin-a'],
      status: 'pending',
      createdAt: new Date('2026-01-01'),
    })
    mockedRepository.persistApproval.mockResolvedValue(undefined)

    const req = await addApproval(1, 'admin-b')

    expect(req.status).toBe('granted')
    expect(req.approverIds).toEqual(['admin-a', 'admin-b'])
    expect(mockedRepository.persistApproval).toHaveBeenCalledWith(1, ['admin-a', 'admin-b'], 'granted')
  })

  it('rejects a duplicated approverId on the same request (409)', async () => {
    mockedRepository.findRequestById.mockResolvedValue({
      id: 1,
      accountabilityLogEntryId: 99,
      legalBasis: 'Court order #123',
      approverIds: ['admin-a'],
      status: 'pending',
      createdAt: new Date('2026-01-01'),
    })

    await expect(addApproval(1, 'admin-a')).rejects.toThrow(HttpError)
    expect(mockedRepository.persistApproval).not.toHaveBeenCalled()
  })
})
