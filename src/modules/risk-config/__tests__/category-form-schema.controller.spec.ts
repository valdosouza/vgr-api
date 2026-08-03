import jwt from 'jsonwebtoken'
import * as aclStore from '@shared/acl/privilege-store'
import request from 'supertest'
import app from '../../../app'
import * as service from '../category-form-schema.service'

jest.mock('../category-form-schema.service')

const mockedService = service as jest.Mocked<typeof service>

jest.mock('@shared/acl/privilege-store')
const mockedAcl = aclStore as jest.Mocked<typeof aclStore>

function tokenFor(role: string): string {
  return jwt.sign({ userId: role === 'admin' ? 1 : 2, role }, process.env.JWT_SECRET ?? 'test-secret')
}

describe('GET /api/category-forms', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId === 1)
  })

  it('returns 200 with every configured schema for an admin caller', async () => {
    mockedService.listCategoryFormSchemas.mockResolvedValue([
      { category: 'missing_person', fields: [{ name: 'age', type: 'number', required: true }] },
    ])

    const res = await request(app)
      .get('/api/category-forms')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      { category: 'missing_person', fields: [{ name: 'age', type: 'number', required: true }] },
    ])
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .get('/api/category-forms')
      .set('Authorization', `Bearer ${tokenFor('reporter')}`)

    expect(res.status).toBe(403)
  })
})

describe('PUT /api/category-forms/:category', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId === 1)
  })

  it('returns 200 with the saved schema when an admin makes the request', async () => {
    mockedService.setCategoryFormSchema.mockResolvedValue(undefined)
    const fields = [{ name: 'age', type: 'number', required: true }]

    const res = await request(app)
      .put('/api/category-forms/missing_person')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ fields })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: { category: 'missing_person', fields } })
    expect(mockedService.setCategoryFormSchema).toHaveBeenCalledWith('missing_person', fields)
  })

  it('returns 403 when a non-admin caller attempts the request', async () => {
    const res = await request(app)
      .put('/api/category-forms/missing_person')
      .set('Authorization', `Bearer ${tokenFor('reporter')}`)
      .send({ fields: [{ name: 'age', type: 'number', required: true }] })

    expect(res.status).toBe(403)
    expect(mockedService.setCategoryFormSchema).not.toHaveBeenCalled()
  })

  it('returns 422 with the standardized error body for an empty fields array', async () => {
    const res = await request(app)
      .put('/api/category-forms/missing_person')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ fields: [] })

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
  })
})
