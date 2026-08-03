import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as repository from '@modules/auth/admin-account.repository'
import { authenticateAdmin } from '@modules/auth/admin-login.service'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/auth/admin-account.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('admin-login.service', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('issues a JWT with role=admin when the password matches the stored bcrypt hash', async () => {
    const passwordHash = await bcrypt.hash('teste', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ id: 1, email: 'valdo@vgr.com.br', passwordHash })

    const token = await authenticateAdmin('valdo@vgr.com.br', 'teste')

    const decoded = jwt.verify(token, 'test-secret') as { userId: number; role: string }
    expect(decoded.userId).toBe(1)
    expect(decoded.role).toBe('admin')
  })

  it('rejects when the password does not match the stored hash', async () => {
    const passwordHash = await bcrypt.hash('teste', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ id: 1, email: 'valdo@vgr.com.br', passwordHash })

    await expect(authenticateAdmin('valdo@vgr.com.br', 'wrong')).rejects.toThrow(HttpError)
  })

  it('rejects when the email does not match any AdminAccount', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(null)

    await expect(authenticateAdmin('unknown@vgr.com.br', 'teste')).rejects.toThrow(HttpError)
  })

  it('never reveals whether the email or the password was wrong (same message/status for both)', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValueOnce(null)
    let unknownEmailError: HttpError | undefined
    try {
      await authenticateAdmin('unknown@vgr.com.br', 'teste')
    } catch (err) {
      unknownEmailError = err as HttpError
    }

    const passwordHash = await bcrypt.hash('teste', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValueOnce({ id: 1, email: 'valdo@vgr.com.br', passwordHash })
    let wrongPasswordError: HttpError | undefined
    try {
      await authenticateAdmin('valdo@vgr.com.br', 'wrong')
    } catch (err) {
      wrongPasswordError = err as HttpError
    }

    expect(unknownEmailError?.statusCode).toBe(401)
    expect(wrongPasswordError?.statusCode).toBe(401)
    expect(unknownEmailError?.message).toBe(wrongPasswordError?.message)
  })
})
