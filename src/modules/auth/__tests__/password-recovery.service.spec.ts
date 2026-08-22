import bcrypt from 'bcryptjs'
import * as repository from '@modules/auth/admin-account.repository'
import * as mailer from '@shared/mailer/mailer'
import logger from '@shared/logger/logger'
import { changePassword, recoveryPassword } from '@modules/auth/password-recovery.service'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/auth/admin-account.repository')
jest.mock('@shared/mailer/mailer')
jest.mock('@shared/logger/logger')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedMailer = mailer as jest.Mocked<typeof mailer>
const mockedLogger = logger as jest.Mocked<typeof logger>

const account = { id: 1, email: 'valdo@vgr.com.br', passwordHash: 'x', active: 'S' as const, sessionVersion: 1, failedLoginCount: 0, totpSecret: null, totpEnabled: 'N' as const }

describe('password-recovery.service recoveryPassword', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedMailer.isMailerConfigured.mockReturnValue(false)
    delete process.env.LOG_DEV_SECRETS
  })

  it('stores a 6-digit code and emails it for an active account', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(account)

    await recoveryPassword('valdo@vgr.com.br')

    const [id, code] = mockedRepository.setActivationKey.mock.calls[0]
    expect(id).toBe(1)
    expect(code).toMatch(/^\d{6}$/)
    expect(mockedMailer.sendMail).toHaveBeenCalled()
  })

  it('resolves silently for an unknown email — no user enumeration', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(null)

    await expect(recoveryPassword('unknown@vgr.com.br')).resolves.toBeUndefined()
    expect(mockedRepository.setActivationKey).not.toHaveBeenCalled()
    expect(mockedMailer.sendMail).not.toHaveBeenCalled()
  })

  it('resolves silently for a deactivated account', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValue({ ...account, active: 'N' })

    await recoveryPassword('valdo@vgr.com.br')
    expect(mockedRepository.setActivationKey).not.toHaveBeenCalled()
  })

  it('still stores the code even when the email send fails', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(account)
    mockedMailer.sendMail.mockRejectedValue(new Error('smtp down'))

    await expect(recoveryPassword('valdo@vgr.com.br')).resolves.toBeUndefined()
    expect(mockedRepository.setActivationKey).toHaveBeenCalled()
  })

  it('never logs the raw recovery code — no SMTP configured is not consent to log a secret (decision 110)', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(account)

    await recoveryPassword('valdo@vgr.com.br')

    for (const call of [...mockedLogger.info.mock.calls, ...mockedLogger.warn.mock.calls, ...mockedLogger.error.mock.calls]) {
      const meta = call[1]
      expect(meta && typeof meta === 'object' ? JSON.stringify(meta) : '').not.toMatch(/\d{6}/)
    }
  })

  it('logs the code only when a developer explicitly opts in via LOG_DEV_SECRETS', async () => {
    process.env.LOG_DEV_SECRETS = 'true'
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(account)

    await recoveryPassword('valdo@vgr.com.br')

    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: expect.stringMatching(/^\d{6}$/) })
    )
  })
})

describe('password-recovery.service changePassword', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(account)
  })

  it('bcrypt-hashes and stores the new password within the 15-minute window', async () => {
    mockedRepository.getActivationInfo.mockResolvedValue({ activationKey: '123456', ageMinutes: 5 })

    await changePassword('valdo@vgr.com.br', '123456', 'new-pass')

    const [id, hash] = mockedRepository.updatePassword.mock.calls[0]
    expect(id).toBe(1)
    expect(await bcrypt.compare('new-pass', hash)).toBe(true)
  })

  it('rejects a wrong code with the generic 401 and counts the attempt (decision 113)', async () => {
    mockedRepository.getActivationInfo.mockResolvedValue({ activationKey: '123456', ageMinutes: 5 })

    await expect(changePassword('valdo@vgr.com.br', '654321', 'new-pass')).rejects.toThrow(HttpError)
    expect(mockedRepository.updatePassword).not.toHaveBeenCalled()
    // The 5th wrong attempt wipes the code inside registerRecoveryAttempt —
    // the service's job is to count every miss while a code exists.
    expect(mockedRepository.registerRecoveryAttempt).toHaveBeenCalledWith(1)
  })

  it('does not count attempts when no code is pending — nothing to brute-force', async () => {
    mockedRepository.getActivationInfo.mockResolvedValue({ activationKey: null, ageMinutes: 0 })

    await expect(changePassword('valdo@vgr.com.br', '654321', 'new-pass')).rejects.toThrow(HttpError)
    expect(mockedRepository.registerRecoveryAttempt).not.toHaveBeenCalled()
  })

  it('rejects an expired code (older than 15 minutes) with the same generic 401', async () => {
    mockedRepository.getActivationInfo.mockResolvedValue({ activationKey: '123456', ageMinutes: 16 })

    let expiredError: HttpError | undefined
    try {
      await changePassword('valdo@vgr.com.br', '123456', 'new-pass')
    } catch (err) {
      expiredError = err as HttpError
    }
    expect(expiredError?.statusCode).toBe(401)
    expect(expiredError?.message).toBe('Invalid or expired code')
  })

  it('rejects an unknown email with the same generic 401', async () => {
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(null)

    await expect(changePassword('unknown@vgr.com.br', '123456', 'new-pass')).rejects.toMatchObject({
      statusCode: 401,
    })
  })
})
