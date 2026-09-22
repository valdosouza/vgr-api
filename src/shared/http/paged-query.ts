import { z } from 'zod'

/**
 * Optional, backward-compatible pagination for the panel LIST endpoints
 * that grow (PS0 of plano-painel-modelo-setes.md — decision 220).
 *
 * Contract:
 * - `page` absent  → the endpoint answers EXACTLY what it answered before
 *   (a plain array), optionally narrowed by `filter`. The current Flutter
 *   screens keep working until each one migrates.
 * - `page` present → `{ items, page, pageSize, total }`, `total` being the
 *   count of rows matching `filter` regardless of the page.
 * - `filter` is trimmed, at most 100 chars, matched with LIKE on the
 *   resource's natural text columns; a blank filter is no filter.
 * - Invalid `page`/`pageSize` → the 422 VALIDATION_FAILED envelope every
 *   other DTO uses (parseQuery — decisions 80/83).
 *
 * Fixed catalogs (risk-config, category-forms, monetization-config) stay
 * un-paginated by the same decision; admin-audit was already paginated
 * with its own mandatory `page` and is untouched.
 */

export const PAGE_SIZE_DEFAULT = 20
export const PAGE_SIZE_MAX = 100
export const FILTER_MAX = 100

export const pagedQueryDto = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  filter: z
    .string()
    .trim()
    .max(FILTER_MAX)
    .optional()
    .transform((value) => (value ? value : undefined)),
})

export type PagedQuery = z.infer<typeof pagedQueryDto>

export interface PagedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

/** The LIMIT/OFFSET window of one page, as the repository receives it. */
export interface PageWindow {
  limit: number
  offset: number
}

/** The trailing fragment a paged SELECT appends; args from limitOffsetArgs. */
export const LIMIT_OFFSET_SQL = 'LIMIT ? OFFSET ?'

export function pageWindow(page: number, pageSize: number): PageWindow {
  return { limit: pageSize, offset: (page - 1) * pageSize }
}

/** Parameter tuple for LIMIT_OFFSET_SQL — never interpolated (decision 110). */
export function limitOffsetArgs(window: PageWindow): [number, number] {
  return [window.limit, window.offset]
}

/**
 * The ONE place the two response shapes of decision 220 are composed.
 * `list` receives the window (undefined = unpaged, legacy); `count` runs
 * only on the paged branch, and an empty count skips the SELECT.
 */
export async function pagedOrPlain<T>(
  query: { page?: number; pageSize: number },
  list: (window?: PageWindow) => Promise<T[]>,
  count: () => Promise<number>
): Promise<T[] | PagedResult<T>> {
  if (query.page === undefined) return list(undefined)

  const total = await count()
  const items = total === 0 ? [] : await list(pageWindow(query.page, query.pageSize))
  return { items, page: query.page, pageSize: query.pageSize, total }
}
