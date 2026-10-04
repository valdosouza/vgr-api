import * as repository from '@modules/admin-access/dual-control.repository'
import {
  createDualControlRequest,
  listDualControlRequests,
  approveDualControlRequest,
} from '@modules/admin-access/dual-control.service'
import { DualControlAccessRequestRow } from '@modules/admin-access/dual-control.interface'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/admin-access/dual-control.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

function requestRow(overrides: Partial<DualControlAccessRequestRow> = {}): DualControlAccessRequestRow {
  return {
    id: 1,
    accountabilityLogEntryId: 99,
    legalBasis: 'Court order #123',
    status: 'pending',
    requestedBy: 7,
    requestedByName: 'Ana',
    approvedBy: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  }
}

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise
  } catch (err) {
    return err as HttpError
  }
  throw new Error('expected a rejection')
}

describe('dual-control.service — request (decisions 223/226)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('records the session user as requester and answers the stored row with names', async () => {
    mockedRepository.accountabilityEntryExists.mockResolvedValue(true)
    mockedRepository.createRequest.mockResolvedValue(1)
    mockedRepository.findRequestById.mockResolvedValue(requestRow())

    const created = await createDualControlRequest(99, 'Court order #123', 7)

    expect(mockedRepository.createRequest).toHaveBeenCalledWith(99, 'Court order #123', 7)
    expect(created).toMatchObject({ id: 1, status: 'pending', requestedBy: 7, requestedByName: 'Ana' })
  })

  it('refuses a request for an accountability entry that does not exist (404)', async () => {
    mockedRepository.accountabilityEntryExists.mockResolvedValue(false)

    const err = await rejection(createDualControlRequest(404, 'Court order #123', 7))

    expect(err).toBeInstanceOf(HttpError)
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(mockedRepository.createRequest).not.toHaveBeenCalled()
  })
})

describe('dual-control.service — list (decisions 220/227)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without page answers the plain list', async () => {
    mockedRepository.listRequests.mockResolvedValue([requestRow()])

    const rows = await listDualControlRequests({ pageSize: 20 })

    expect(rows).toHaveLength(1)
    expect(mockedRepository.listRequests).toHaveBeenCalledWith(undefined, undefined)
    expect(mockedRepository.countRequests).not.toHaveBeenCalled()
  })

  it('with page answers the envelope, filter passed to list and count', async () => {
    mockedRepository.countRequests.mockResolvedValue(21)
    mockedRepository.listRequests.mockResolvedValue([requestRow()])

    const result = await listDualControlRequests({ page: 2, pageSize: 20, filter: 'Court' })

    expect(result).toEqual({ items: [requestRow()], page: 2, pageSize: 20, total: 21 })
    expect(mockedRepository.countRequests).toHaveBeenCalledWith('Court')
    expect(mockedRepository.listRequests).toHaveBeenCalledWith('Court', { limit: 20, offset: 20 })
  })
})

describe('dual-control.service — approve (decision 224)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('grants on ONE approval by a user other than the requester', async () => {
    mockedRepository.findRequestById
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce(
        requestRow({ status: 'granted', approvedBy: 8, approvedByName: 'Bia', approvedAt: new Date('2026-01-02') })
      )
    mockedRepository.grantRequest.mockResolvedValue(true)

    const granted = await approveDualControlRequest(1, 8)

    expect(mockedRepository.grantRequest).toHaveBeenCalledWith(1, 8)
    expect(granted).toMatchObject({ status: 'granted', requestedBy: 7, approvedBy: 8, approvedByName: 'Bia' })
  })

  it('refuses the requester approving their own request (422 BUSINESS_RULE) — one person never grants alone', async () => {
    mockedRepository.findRequestById.mockResolvedValue(requestRow())

    const err = await rejection(approveDualControlRequest(1, 7))

    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('BUSINESS_RULE')
    expect(mockedRepository.grantRequest).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown request', async () => {
    mockedRepository.findRequestById.mockResolvedValue(null)

    const err = await rejection(approveDualControlRequest(5, 8))

    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
  })

  it.each(['granted', 'void'] as const)('refuses approving a %s request (409, not awaiting approval)', async (status) => {
    mockedRepository.findRequestById.mockResolvedValue(requestRow({ status, requestedBy: status === 'void' ? null : 7 }))

    const err = await rejection(approveDualControlRequest(1, 8))

    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('BUSINESS_RULE')
    expect(mockedRepository.grantRequest).not.toHaveBeenCalled()
  })

  it('answers 409 to the loser of two simultaneous approvals — the conditional write changed nothing', async () => {
    mockedRepository.findRequestById.mockResolvedValue(requestRow())
    mockedRepository.grantRequest.mockResolvedValue(false)

    const err = await rejection(approveDualControlRequest(1, 8))

    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('BUSINESS_RULE')
    expect(mockedRepository.findRequestById).toHaveBeenCalledTimes(1)
  })
})
