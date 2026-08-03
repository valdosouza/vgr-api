import * as repository from '@modules/panic/responder-pool.repository'
import {
  requestResponderAuthorization,
  listPendingResponderRequests,
  resolveResponderRequest,
  findActiveResponders,
} from '@modules/panic/responder-pool.service'

jest.mock('@modules/panic/responder-pool.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('responder-pool.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('creates a pending membership request regardless of caller Role', async () => {
    mockedRepository.createMembershipRequest.mockResolvedValue({
      id: 1,
      userId: 42,
      status: 'pending',
      criteriaNotes: null,
      requestedAt: new Date('2026-01-01'),
      resolvedAt: null,
      resolvedBy: null,
    })

    const membership = await requestResponderAuthorization(42, null)

    expect(membership.status).toBe('pending')
    expect(mockedRepository.createMembershipRequest).toHaveBeenCalledWith(42, null)
  })

  it('passes free-text criteriaNotes through to the repository (decision 52 still open, no validation rules yet)', async () => {
    mockedRepository.createMembershipRequest.mockResolvedValue({
      id: 1,
      userId: 42,
      status: 'pending',
      criteriaNotes: 'Volunteer firefighter, 5 years',
      requestedAt: new Date('2026-01-01'),
      resolvedAt: null,
      resolvedBy: null,
    })

    const membership = await requestResponderAuthorization(42, 'Volunteer firefighter, 5 years')

    expect(membership.criteriaNotes).toBe('Volunteer firefighter, 5 years')
    expect(mockedRepository.createMembershipRequest).toHaveBeenCalledWith(42, 'Volunteer firefighter, 5 years')
  })

  it('lists pending membership requests for the admin queue', async () => {
    mockedRepository.findPendingMemberships.mockResolvedValue([
      { id: 1, userId: 42, status: 'pending', criteriaNotes: null, requestedAt: new Date(), resolvedAt: null, resolvedBy: null },
    ])

    const pending = await listPendingResponderRequests()

    expect(pending).toHaveLength(1)
    expect(mockedRepository.findPendingMemberships).toHaveBeenCalled()
  })

  it('resolves a request as approved and forwards the resolving admin', async () => {
    await resolveResponderRequest(1, true, 7)

    expect(mockedRepository.resolveMembership).toHaveBeenCalledWith(1, true, 7)
  })

  it('resolves a request as denied', async () => {
    await resolveResponderRequest(1, false, 7)

    expect(mockedRepository.resolveMembership).toHaveBeenCalledWith(1, false, 7)
  })

  it('returns only actively approved members for panic-alert routing', async () => {
    mockedRepository.findActiveMembers.mockResolvedValue([
      { id: 1, userId: 42, status: 'approved', criteriaNotes: null, requestedAt: new Date(), resolvedAt: new Date(), resolvedBy: 7 },
    ])

    const active = await findActiveResponders()

    expect(active).toHaveLength(1)
    expect(active[0].status).toBe('approved')
  })
})
