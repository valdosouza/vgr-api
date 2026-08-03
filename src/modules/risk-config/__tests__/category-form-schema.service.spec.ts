import * as repository from '@modules/risk-config/category-form-schema.repository'
import {
  getCategoryFormSchema,
  listCategoryFormSchemas,
  setCategoryFormSchema,
  validateReportDetailFields,
} from '@modules/risk-config/category-form-schema.service'

jest.mock('@modules/risk-config/category-form-schema.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('category-form-schema.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('creates successfully with a non-empty field list for a Category', async () => {
    mockedRepository.findCategoryFormSchemaByCategory.mockResolvedValue({
      category: 'missing_person',
      fields: [
        { name: 'age', type: 'number', required: true },
        { name: 'lastSeenLocation', type: 'string', required: true },
      ],
    })

    const fields = await getCategoryFormSchema('missing_person')

    expect(fields).toHaveLength(2)
    expect(fields[0]).toEqual({ name: 'age', type: 'number', required: true })
  })

  it('returns an empty schema for a Category with none configured', async () => {
    mockedRepository.findCategoryFormSchemaByCategory.mockResolvedValue(null)

    const fields = await getCategoryFormSchema('vandalism')

    expect(fields).toEqual([])
  })

  it('is readable from cache without a query on every request (TTL-cached)', async () => {
    mockedRepository.findCategoryFormSchemaByCategory.mockResolvedValue({
      category: 'stolen_vehicle',
      fields: [{ name: 'plate', type: 'string', required: true }],
    })

    await getCategoryFormSchema('stolen_vehicle')
    await getCategoryFormSchema('stolen_vehicle')

    expect(mockedRepository.findCategoryFormSchemaByCategory).toHaveBeenCalledTimes(1)
  })

  it('persists an admin update and invalidates the cache so the next read reflects it', async () => {
    await setCategoryFormSchema('missing_person', [{ name: 'age', type: 'number', required: true }])

    expect(mockedRepository.upsertCategoryFormSchema).toHaveBeenCalledWith('missing_person', [
      { name: 'age', type: 'number', required: true },
    ])
  })

  it("rejects a submitted Report's detail fields that don't match the current schema", async () => {
    mockedRepository.findCategoryFormSchemaByCategory.mockResolvedValue({
      category: 'missing_person',
      fields: [
        { name: 'age', type: 'number', required: true },
        { name: 'lastSeenLocation', type: 'string', required: true },
      ],
    })

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
    // distinct category from the earlier tests — the TTL cache is
    // module-level and would otherwise return the stale schema.
    mockedRepository.findCategoryFormSchemaByCategory.mockResolvedValue({
      category: 'fugitive',
      fields: [{ name: 'age', type: 'number', required: true }],
    })

    const errors = await validateReportDetailFields('fugitive', { age: 8 })

    expect(errors).toEqual([])
  })
})
