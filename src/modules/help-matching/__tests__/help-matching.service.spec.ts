import * as repository from '@modules/help-matching/help-matching.repository'
import * as service from '@modules/help-matching/help-matching.service'
import { NearbyReportRow } from '@modules/help-matching/help-matching.interface'
import { getRiskTier } from '@shared/risk/risk-tier'

jest.mock('@modules/help-matching/help-matching.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

const VIEWER = { lat: -23.55, lng: -46.63 }

function row(overrides: Partial<NearbyReportRow> = {}): NearbyReportRow {
  return {
    id: 1,
    category: 'assault',
    freeTag: null,
    subject: 'adult',
    lat: -23.556789,
    lng: -46.634567,
    createdAt: new Date('2026-08-03T14:37:42Z'),
    distanceKm: 0.9,
    radiusKm: 2,
    ...overrides,
  }
}

async function feed(rows: NearbyReportRow[], page = 1) {
  mockedRepository.listNearby.mockResolvedValue(rows)
  return service.listNearbyReports({ ...VIEWER, page, order: 'recency' })
}

describe('help-matching.service — feed degradation (decisions 21/41/135)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('high')
    mockedRepository.findDirectionEstimates.mockResolvedValue(new Map())
  })

  it('high tier: neighborhood grid, stepped distance, hour-rounded time', async () => {
    const page = await feed([row()])
    const item = page.items[0]

    // 0.01° grid — the victim's exact address is not derivable.
    expect(item.position).toEqual({ lat: -23.56, lng: -46.63 })
    expect(item.distanceKm % 1).toBe(0) // 1 km steps
    expect(item.createdAt).toBe('2026-08-03T14:00:00.000Z') // hour bucket
    expect(item.tier).toBe('high')
  })

  it('low tier: street-level grid and minute-rounded time', async () => {
    mockedTier.mockResolvedValue('low')
    const page = await feed([row({ category: 'vandalism' })])
    const item = page.items[0]

    expect(item.position).toEqual({ lat: -23.557, lng: -46.635 })
    expect(item.createdAt).toBe('2026-08-03T14:37:00.000Z')
  })

  it('NEVER serves the exact position or any reporter field (decision 135)', async () => {
    const page = await feed([row()])
    const item = page.items[0] as any

    expect(item.position.lat).not.toBe(-23.556789)
    expect(item.position.lng).not.toBe(-46.634567)
    expect(Object.keys(item).sort()).toEqual(
      [
        'category',
        'createdAt',
        'directionEstimate',
        'distanceKm',
        'freeTag',
        'position',
        'reportId',
        'subject',
        'tier',
      ].sort()
    )
  })

  it('distance is derived from the DEGRADED position (anti-trilateration)', async () => {
    const page = await feed([row()])
    // SQL said 0.9 km from the exact point; the served value comes from
    // the snapped grid point instead — and lands on the tier step.
    expect(page.items[0].distanceKm).not.toBe(0.9)
  })

  it('paginates at 20 with a hasMore probe row', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => row({ id: i + 1 }))
    const page = await feed(rows)
    expect(page.items).toHaveLength(20)
    expect(page.hasMore).toBe(true)
  })

  it('one tier lookup per distinct category, not per row', async () => {
    await feed([
      row({ id: 1, category: 'assault' }),
      row({ id: 2, category: 'assault' }),
      row({ id: 3, category: 'vandalism' }),
    ])
    expect(mockedTier).toHaveBeenCalledTimes(2)
  })

  it('free-tag reports flow through with the null-category tier', async () => {
    mockedTier.mockResolvedValue('medium')
    const page = await feed([row({ category: null, freeTag: 'som alto' })])
    expect(mockedTier).toHaveBeenCalledWith(null)
    expect(page.items[0].freeTag).toBe('som alto')
  })
})

/** DS1 (decisions 200-207, 204's "even the anonymous public feed"): the
 *  feed batches ONE direction-estimate query per page — never one per
 *  row — the same discipline the risk-tier lookup above already applies
 *  to categories. */
describe('help-matching.service — direction estimate facet (DS1, decisions 200-204)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.findDirectionEstimates.mockResolvedValue(new Map())
  })

  it('attaches { direction } per item from the batched map', async () => {
    mockedRepository.findDirectionEstimates.mockResolvedValue(
      new Map([[1, { direction: 'N' as const }]])
    )
    const page = await feed([row({ id: 1 })])
    expect(page.items[0].directionEstimate).toEqual({ direction: 'N' })
  })

  it('is null for a report absent from the batched map (below the floor, or ineligible)', async () => {
    mockedRepository.findDirectionEstimates.mockResolvedValue(new Map())
    const page = await feed([row({ id: 1 })])
    expect(page.items[0].directionEstimate).toBeNull()
  })

  it('issues exactly ONE query for the whole page, regardless of page size — never N+1', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({ id: i + 1 }))
    await feed(rows)
    expect(mockedRepository.findDirectionEstimates).toHaveBeenCalledTimes(1)
    expect(mockedRepository.findDirectionEstimates).toHaveBeenCalledWith(
      expect.arrayContaining(rows.slice(0, 20).map((r) => r.id))
    )
  })

  it('skips the query entirely for an EMPTY page — no wasted round-trip', async () => {
    await feed([])
    expect(mockedRepository.findDirectionEstimates).not.toHaveBeenCalled()
  })
})
