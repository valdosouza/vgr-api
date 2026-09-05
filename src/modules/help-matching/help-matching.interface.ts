import { Category, Subject } from '@shared/taxonomy/taxonomy'
import { RiskTier } from '@shared/risk/risk-tier'
import { Direction } from '@shared/direction-sighting/direction-estimate'

export type FeedOrder = 'recency' | 'relevance'

/** Raw row from the feed query — EXACT position; never leaves the service. */
export interface NearbyReportRow {
  id: number
  category: Category | null
  freeTag: string | null
  subject: Subject
  lat: number
  lng: number
  createdAt: Date
  distanceKm: number
  radiusKm: number
}

/**
 * What the public feed serves (decision 135): degraded position, rounded
 * distance and time — never reporterId, never engagement data (41/60).
 */
export interface FeedItem {
  reportId: number
  category: Category | null
  freeTag: string | null
  subject: Subject
  tier: RiskTier
  position: { lat: number; lng: number }
  distanceKm: number
  createdAt: string
  /** DS1 (decisions 200-207): the second place decision 204 requires the
   *  facet, since the feed IS the anonymous public view — null below the
   *  disclosure floor (202) or when the category is ineligible (201).
   *  Never a count, never a distribution (203). */
  directionEstimate: { direction: Direction } | null
}

export interface FeedQuery {
  lat: number
  lng: number
  page: number
  order: FeedOrder
}

export interface FeedPage {
  items: FeedItem[]
  page: number
  hasMore: boolean
  order: FeedOrder
}
