import pool from '@shared/db/connection'
import * as repository from '@modules/risk-config/category-form-schema.repository'
import {
  getCategoryFormSchema,
  listCategoryFormSchemas,
  setCategoryFormSchema,
  validateReportDetailFields,
} from '@modules/risk-config/category-form-schema.service'
import { invalidateCategoryFormCache } from '@shared/risk/category-form'

jest.mock('@modules/risk-config/category-form-schema.repository')
// The READ path moved to @shared/risk/category-form (report-front E8) and
// queries the pool directly — the module repository now only backs the
// admin CRUD, so reads are mocked at the pool.
jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedQuery = pool.query as jest.Mock

function dbSchema(fields: unknown[]): [unknown[]] {
  return [[{ fields: JSON.stringify(fields) }]]
}

describe('category-form-schema.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    invalidateCategoryFormCache()
  })

  it('creates successfully with a non-empty field list for a Category', async () => {
    mockedQuery.mockResolvedValue(
      dbSchema([
        { name: 'age', type: 'number', required: true },
        { name: 'lastSeenLocation', type: 'string', required: true },
      ])
    )

    const fields = await getCategoryFormSchema('missing_person')

    expect(fields).toHaveLength(2)
    expect(fields[0]).toEqual({ name: 'age', type: 'number', required: true })
  })

  it('returns an empty schema for a Category with none configured', async () => {
    mockedQuery.mockResolvedValue([[]])

    const fields = await getCategoryFormSchema('vandalism')

    expect(fields).toEqual([])
  })

  it('is readable from cache without a query on every request (TTL-cached)', async () => {
    mockedQuery.mockResolvedValue(dbSchema([{ name: 'plate', type: 'string', required: true }]))

    await getCategoryFormSchema('stolen_vehicle')
    await getCategoryFormSchema('stolen_vehicle')

    expect(mockedQuery).toHaveBeenCalledTimes(1)
  })

  it('persists an admin update and invalidates the cache so the next read reflects it', async () => {
    mockedQuery.mockResolvedValue(dbSchema([{ name: 'age', type: 'number', required: true }]))
    await getCategoryFormSchema('missing_person') // warm the cache

    await setCategoryFormSchema('missing_person', [{ name: 'age', type: 'number', required: true }])

    expect(mockedRepository.upsertCategoryFormSchema).toHaveBeenCalledWith('missing_person', [
      { name: 'age', type: 'number', required: true },
    ])
    // Cache was invalidated: the next read queries again.
    await getCategoryFormSchema('missing_person')
    expect(mockedQuery).toHaveBeenCalledTimes(2)
  })

  it("rejects a submitted Report's detail fields that don't match the current schema", async () => {
    mockedQuery.mockResolvedValue(
      dbSchema([
        { name: 'age', type: 'number', required: true },
        { name: 'lastSeenLocation', type: 'string', required: true },
      ])
    )

    const errors = await validateReportDetailFields('missing_person', { age: 8 })

    expect(errors).toEqual(['lastSeenLocation is required'])
  })

  it('returns every configured CategoryFormSchema row', async () => {
    mockedRepository.findAllCategoryFormSchemas.mockResolvedValue([
      { category: 'missing_person', fields: [{ name: 'age', type: 'number', required: true }] },
    ])

    const rows = await listCategoryFormSchemas()

    expect(rows).toEqual([
      { category: 'missing_person', fields: [{ name: 'age', type: 'number', required: true }] },
    ])
  })

  it('accepts submitted fields that satisfy every required schema field', async () => {
    mockedQuery.mockResolvedValue(dbSchema([{ name: 'age', type: 'number', required: true }]))

    const errors = await validateReportDetailFields('fugitive', { age: 8 })

    expect(errors).toEqual([])
  })
})
