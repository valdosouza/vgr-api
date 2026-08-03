import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as repository from '@modules/auth/admin-account.repository'
import { signEnrollToken } from '@modules/auth/admin-login.service'
import {
  activateEnrollment,
  recoverWithCode,
  startEnrollment,
} from '@modules/auth/two-factor.service'
import { encryptEnvelope } from '@shared/crypto/envelope'
import { currentTotp, generateTotpSecret } from '@shared/security/totp'

jest.mock('@modules/auth/admin-account.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

import { AdminAccountRow } from '@modules/auth/admin-account.interface'

function account(overrides: Partial<AdminAccountRow> = {}): AdminAccountRow {
  return {
    id: 1,
    email: 'valdo@vgr.com.br',
    passwordHash: 'x',
    active: 'S',
    sessionVersion: 1,
    failedLoginCount: 0,
    totpSecret: null,
    totpEnabled: 'N',
    ...overrides,
  }
}

describe('two-factor.service (decision 114)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
    process.env.LEGAL_KEK = randomBytes(32).toString('base64')
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('startEnrollment stores the secret ENCRYPTED and returns the QR URI', async () => {
    mockedRepository.findAdminAccountById.mockResolvedValue(account())

    const result = await startEnrollment(signEnrollToken(1))

    expect(result.otpauthUri).toContain('otpauth://totp/')
    const [userId, stored] = mockedRepository.setTotpSecret.mock.calls[0]
    expect(userId).toBe(1)
    expect(stored).not.toContain(result.secret)
    expect(stored.startsWith('v1.k')).toBe(true)
  })

  it('rejects a full session JWT on the enrollment endpoints — enroll scope only', async () => {
    const fullToken = jwt.sign({ userId: 1, role: 'admin', sv: 1 }, 'test-secret')
    await expect(startEnrollment(fullToken)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('activateEnrollment verifies the first code, enables 2FA and mints 10 single-use recovery codes', async () => {
    const secret = generateTotpSecret()
    mockedRepository.findAdminAccountById.mockResolvedValue(
      account({ totpSecret: encryptEnvelope(secret) })
    )

    const result = await activateEnrollment(signEnrollToken(1), currentTotp(secret))

    expect(result.recoveryCodes).toHaveLength(10)
    expect(mockedRepository.enableTotp).toHaveBeenCalledWith(1)
    const [, hashes] = mockedRepository.replaceRecoveryCodes.mock.calls[0]
    expect(hashes).toHaveLength(10)
    // Stored hashed, never in clear (decision 110).
    expect(hashes[0]).not.toBe(result.recoveryCodes[0])
    expect(await bcrypt.compare(result.recoveryCodes[0], hashes[0])).toBe(true)
    expect(jwt.verify(result.jwt, 'test-secret')).toMatchObject({ userId: 1 })
  })

  it('activateEnrollment rejects a wrong code without enabling anything', async () => {
    const secret = generateTotpSecret()
    mockedRepository.findAdminAccountById.mockResolvedValue(
      account({ totpSecret: encryptEnvelope(secret) })
    )

    await expect(activateEnrollment(signEnrollToken(1), '000000')).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(mockedRepository.enableTotp).not.toHaveBeenCalled()
  })

  it('recoverWithCode needs the PASSWORD too, consumes the code and forces re-enrollment', async () => {
    const passwordHash = await bcrypt.hash('senha-legitima-12', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(
      account({ passwordHash, totpEnabled: 'S' })
    )
    const codeHash = await bcrypt.hash('AABBCCDDEE', 10)
    mockedRepository.listUnusedRecoveryCodes.mockResolvedValue([{ id: 5, codeHash }])

    const result = await recoverWithCode('valdo@vgr.com.br', 'senha-legitima-12', 'aabbccddee')

    expect(jwt.verify(result.jwt, 'test-secret')).toMatchObject({ userId: 1 })
    expect(mockedRepository.markRecoveryCodeUsed).toHaveBeenCalledWith(5)
    expect(mockedRepository.clearTotp).toHaveBeenCalledWith(1)
  })

  it('recoverWithCode rejects a wrong password even with a valid recovery code', async () => {
    const passwordHash = await bcrypt.hash('senha-legitima-12', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(
      account({ passwordHash, totpEnabled: 'S' })
    )
    mockedRepository.listUnusedRecoveryCodes.mockResolvedValue([
      { id: 5, codeHash: await bcrypt.hash('AABBCCDDEE', 10) },
    ])

    await expect(
      recoverWithCode('valdo@vgr.com.br', 'wrong', 'AABBCCDDEE')
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(mockedRepository.markRecoveryCodeUsed).not.toHaveBeenCalled()
  })

  it('recoverWithCode rejects an already-used or unknown code', async () => {
    const passwordHash = await bcrypt.hash('senha-legitima-12', 10)
    mockedRepository.findAdminAccountByEmail.mockResolvedValue(
      account({ passwordHash, totpEnabled: 'S' })
    )
    mockedRepository.listUnusedRecoveryCodes.mockResolvedValue([])

    await expect(
      recoverWithCode('valdo@vgr.com.br', 'senha-legitima-12', 'AABBCCDDEE')
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
