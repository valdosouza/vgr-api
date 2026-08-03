import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as repository from '@modules/auth/admin-account.repository'
import { authenticateAdmin } from '@modules/auth/admin-login.service'
import { encryptEnvelope } from '@shared/crypto/envelope'
import { currentTotp, generateTotpSecret } from '@shared/security/totp'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/auth/admin-account.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('admin-login.service', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
    process.env.LEGAL_KEK = randomBytes(32).toString('base64')
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('demands mandatory 2FA enrollment on first login — enroll token, never a full JWT (decision 114)', async () => {
    const passwordHash = await bcrypt.hash('teste', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ id: 1, email: 'valdo@vgr.com.br', passwordHash, active: 'S', sessionVersion: 1, failedLoginCount: 0, totpSecret: null, totpEnabled: 'N' as const })

    const result = await authenticateAdmin('valdo@vgr.com.br', 'teste')

    expect(result.kind).toBe('enroll')
    const decoded = jwt.verify((result as any).enrollToken, 'test-secret') as { scope: string }
    expect(decoded.scope).toBe('2fa_enroll')
  })

  it('issues the session JWT when password AND TOTP code are valid', async () => {
    const passwordHash = await bcrypt.hash('teste', 10)
    const secret = generateTotpSecret()
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ id: 1, email: 'valdo@vgr.com.br', passwordHash, active: 'S', sessionVersion: 2, failedLoginCount: 0, totpSecret: encryptEnvelope(secret), totpEnabled: 'S' as const })

    const result = await authenticateAdmin('valdo@vgr.com.br', 'teste', currentTotp(secret))

    expect(result.kind).toBe('session')
    const decoded = jwt.verify((result as any).jwt, 'test-secret') as { userId: number; role: string; sv: number }
    expect(decoded).toMatchObject({ userId: 1, role: 'admin', sv: 2 })
    expect(mockedRepository.registerLogin).toHaveBeenCalledWith(1)
  })

  it('rejects with TWO_FACTOR_REQUIRED when enrolled and the code is missing or wrong', async () => {
    const passwordHash = await bcrypt.hash('teste', 10)
    const secret = generateTotpSecret()
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ id: 1, email: 'valdo@vgr.com.br', passwordHash, active: 'S', sessionVersion: 1, failedLoginCount: 0, totpSecret: encryptEnvelope(secret), totpEnabled: 'S' as const })

    await expect(authenticateAdmin('valdo@vgr.com.br', 'teste')).rejects.toMatchObject({
      statusCode: 401,
      code: 'TWO_FACTOR_REQUIRED',
    })
    await expect(authenticateAdmin('valdo@vgr.com.br', 'teste', '000000')).rejects.toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    })
    // Wrong second factor counts toward the progressive delay too.
    expect(mockedRepository.registerFailedLogin).toHaveBeenCalledTimes(2)
  })

  it('rejects when the password does not match the stored hash', async () => {
    const passwordHash = await bcrypt.hash('teste', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ id: 1, email: 'valdo@vgr.com.br', passwordHash, active: 'S', sessionVersion: 1, failedLoginCount: 0, totpSecret: null, totpEnabled: 'N' as const })

    await expect(authenticateAdmin('valdo@vgr.com.br', 'wrong')).rejects.toThrow(HttpError)
  })

  it('rejects a deactivated account with the same generic 401 (no account enumeration)', async () => {
    const passwordHash = await bcrypt.hash('teste', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ id: 1, email: 'valdo@vgr.com.br', passwordHash, active: 'N', sessionVersion: 1, failedLoginCount: 0, totpSecret: null, totpEnabled: 'N' as const })

    let inactiveError: HttpError | undefined
    try {
      await authenticateAdmin('valdo@vgr.com.br', 'teste')
    } catch (err) {
      inactiveError = err as HttpError
    }
    expect(inactiveError?.statusCode).toBe(401)
    expect(inactiveError?.message).toBe('Invalid email or password')
    expect(mockedRepository.registerLogin).not.toHaveBeenCalled()
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
    mockedRepository.findAdminAccountByEmail.mockResolvedValueOnce({ id: 1, email: 'valdo@vgr.com.br', passwordHash, active: 'S', sessionVersion: 1, failedLoginCount: 0, totpSecret: null, totpEnabled: 'N' as const })
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
