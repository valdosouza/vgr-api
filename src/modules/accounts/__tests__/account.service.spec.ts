import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import * as repository from '@modules/accounts/account.repository'
import * as service from '@modules/accounts/account.service'
import {
  UserAccountRow,
  VerifiedProviderIdentity,
} from '@modules/accounts/account.interface'
import { verifyAppAccessToken } from '@shared/auth/app-session'
import { encryptEnvelope } from '@shared/crypto/envelope'
import { currentTotp, generateTotpSecret } from '@shared/security/totp'

jest.mock('@modules/accounts/account.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

function account(overrides: Partial<UserAccountRow> = {}): UserAccountRow {
  return {
    id: 1,
    displayName: 'Ana',
    email: 'ana@example.com',
    emailVerified: false,
    phone: null,
    phoneVerified: false,
    passwordHash: null,
    jurisdiction: 'BR',
    consentVersion: 'v1',
    sessionVersion: 1,
    failedLoginCount: 0,
    totpSecret: null,
    totpEnabled: false,
    active: true,
    ...overrides,
  }
}

function identity(overrides: Partial<VerifiedProviderIdentity> = {}): VerifiedProviderIdentity {
  return {
    provider: 'google',
    sub: 'google-sub-1',
    email: 'ana@example.com',
    emailVerified: true,
    displayName: 'Ana',
    isPrivateRelayEmail: false,
    ...overrides,
  }
}

describe('account.service', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
    process.env.LEGAL_KEK = randomBytes(32).toString('base64')
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('registration (decision 123 — the report never waits)', () => {
    it('issues a session immediately, with the email still unverified', async () => {
      mockedRepository.findAccountByEmail.mockResolvedValue(null)
      mockedRepository.insertAccount.mockResolvedValue(7)
      mockedRepository.findAccountById.mockResolvedValue(account({ id: 7 }))

      const session = await service.registerWithPassword({
        displayName: 'Ana',
        email: 'ana@example.com',
        password: 'uma senha longa o suficiente',
        consentVersion: 'v1',
      })

      expect(verifyAppAccessToken(session.accessToken).accountId).toBe(7)
      expect(session.refreshToken).toBeTruthy()
      // No verification gate stands between signing up and reporting.
      expect(mockedRepository.markEmailVerified).not.toHaveBeenCalled()
    })

    it('records the consent version — registration is not complete without it', async () => {
      mockedRepository.findAccountByEmail.mockResolvedValue(null)
      mockedRepository.insertAccount.mockResolvedValue(7)
      mockedRepository.findAccountById.mockResolvedValue(account({ id: 7 }))

      await service.registerWithPassword({
        displayName: 'Ana',
        email: 'ana@example.com',
        password: 'uma senha longa o suficiente',
        consentVersion: 'v3',
      })

      expect(mockedRepository.insertAccount).toHaveBeenCalledWith(
        expect.objectContaining({ consentVersion: 'v3' })
      )
    })

    it('rejects a duplicate email', async () => {
      mockedRepository.findAccountByEmail.mockResolvedValue(account())

      await expect(
        service.registerWithPassword({
          displayName: 'Ana',
          email: 'ana@example.com',
          password: 'uma senha longa o suficiente',
          consentVersion: 'v1',
        })
      ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE' })
    })
  })

  describe('password login', () => {
    it('issues access + refresh on valid credentials', async () => {
      const passwordHash = await bcrypt.hash('uma senha longa o suficiente', 10)
      mockedRepository.findAccountByEmail.mockResolvedValue(account({ passwordHash }))

      const session = await service.loginWithPassword(
        'ana@example.com',
        'uma senha longa o suficiente'
      )

      expect(verifyAppAccessToken(session.accessToken).accountId).toBe(1)
      expect(mockedRepository.clearFailedLogins).toHaveBeenCalledWith(1)
    })

    it('gives a social-only account the same generic 401 — never reveals which providers an email uses', async () => {
      mockedRepository.findAccountByEmail.mockResolvedValue(account({ passwordHash: null }))

      await expect(
        service.loginWithPassword('ana@example.com', 'qualquer coisa aqui')
      ).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' })
    })

    it('counts failures for the progressive delay (decision 113)', async () => {
      const passwordHash = await bcrypt.hash('uma senha longa o suficiente', 10)
      mockedRepository.findAccountByEmail.mockResolvedValue(account({ passwordHash }))

      await expect(service.loginWithPassword('ana@example.com', 'errada')).rejects.toBeDefined()

      expect(mockedRepository.registerFailedLogin).toHaveBeenCalledWith(1)
    })

    it('demands the optional TOTP once the account enabled it (decision 124)', async () => {
      const passwordHash = await bcrypt.hash('uma senha longa o suficiente', 10)
      const secret = generateTotpSecret()
      mockedRepository.findAccountByEmail.mockResolvedValue(
        account({ passwordHash, totpEnabled: true, totpSecret: encryptEnvelope(secret) })
      )

      await expect(
        service.loginWithPassword('ana@example.com', 'uma senha longa o suficiente')
      ).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' })

      const session = await service.loginWithPassword(
        'ana@example.com',
        'uma senha longa o suficiente',
        currentTotp(secret)
      )
      expect(session.accessToken).toBeTruthy()
    })
  })

  describe('provider linking (decision 121)', () => {
    it('signs in an already-linked provider identity', async () => {
      mockedRepository.findProviderIdentity.mockResolvedValue({
        id: 1,
        accountId: 4,
        provider: 'google',
        providerSub: 'google-sub-1',
        email: 'ana@example.com',
        emailVerified: true,
      })
      mockedRepository.findAccountById.mockResolvedValue(account({ id: 4 }))

      const session = await service.loginWithProvider(identity())

      expect(session.accountId).toBe(4)
      expect(mockedRepository.insertAccount).not.toHaveBeenCalled()
    })

    it('auto-links only when the email is verified on BOTH sides', async () => {
      mockedRepository.findProviderIdentity.mockResolvedValue(null)
      mockedRepository.findAccountByEmail.mockResolvedValue(
        account({ id: 9, emailVerified: true })
      )

      const session = await service.loginWithProvider(identity())

      expect(session.accountId).toBe(9)
      expect(mockedRepository.linkProvider).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 9, provider: 'google' })
      )
    })

    it('refuses to auto-link into an UNVERIFIED local account — the takeover vector', async () => {
      mockedRepository.findProviderIdentity.mockResolvedValue(null)
      mockedRepository.findAccountByEmail.mockResolvedValue(
        account({ id: 9, emailVerified: false })
      )

      await expect(service.loginWithProvider(identity())).rejects.toMatchObject({
        statusCode: 409,
        params: { reason: 'link_requires_password' },
      })
      expect(mockedRepository.linkProvider).not.toHaveBeenCalled()
    })

    it('never auto-links an unverified provider email', async () => {
      mockedRepository.findProviderIdentity.mockResolvedValue(null)
      mockedRepository.insertAccount.mockResolvedValue(11)
      mockedRepository.findAccountById.mockResolvedValue(account({ id: 11 }))

      await service.loginWithProvider(identity({ emailVerified: false }))

      // Went straight to a new account without even looking for a match.
      expect(mockedRepository.findAccountByEmail).not.toHaveBeenCalled()
      expect(mockedRepository.insertAccount).toHaveBeenCalled()
    })

    it("never auto-links Apple's private relay address, and does not store it", async () => {
      mockedRepository.findProviderIdentity.mockResolvedValue(null)
      mockedRepository.insertAccount.mockResolvedValue(12)
      mockedRepository.findAccountById.mockResolvedValue(account({ id: 12 }))

      await service.loginWithProvider(
        identity({
          provider: 'apple',
          email: 'abc@privaterelay.appleid.com',
          isPrivateRelayEmail: true,
        })
      )

      expect(mockedRepository.findAccountByEmail).not.toHaveBeenCalled()
      expect(mockedRepository.insertAccount).toHaveBeenCalledWith(
        expect.objectContaining({ email: null })
      )
      expect(mockedRepository.markEmailVerified).not.toHaveBeenCalled()
    })

    it('refuses to unlink the only sign-in method', async () => {
      mockedRepository.listProvidersOfAccount.mockResolvedValue([
        { id: 1, accountId: 1, provider: 'google', providerSub: 's', email: null, emailVerified: true },
      ])

      await expect(service.unlinkProviderFromAccount(1, 'google')).rejects.toMatchObject({
        code: 'SELF_LOCKOUT',
      })
      expect(mockedRepository.unlinkProvider).not.toHaveBeenCalled()
    })

    it('refuses to link an identity already owned by another account', async () => {
      mockedRepository.findProviderIdentity.mockResolvedValue({
        id: 1,
        accountId: 99,
        provider: 'google',
        providerSub: 'google-sub-1',
        email: null,
        emailVerified: true,
      })

      await expect(service.linkProviderToAccount(1, identity())).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE',
      })
    })
  })

  describe('refresh rotation (decision 122)', () => {
    it('rotates within the same family and marks the old token used', async () => {
      mockedRepository.findRefreshToken.mockResolvedValue({
        id: 5,
        accountId: 1,
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: null,
        revokedAt: null,
      })
      mockedRepository.findAccountById.mockResolvedValue(account())

      const session = await service.refreshSession('some-refresh-token')

      expect(mockedRepository.markRefreshTokenUsed).toHaveBeenCalledWith(5)
      expect(mockedRepository.insertRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' })
      )
      expect(session.accessToken).toBeTruthy()
    })

    it('reuse of a rotated token revokes the whole family and every session', async () => {
      mockedRepository.findRefreshToken.mockResolvedValue({
        id: 5,
        accountId: 1,
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: new Date(),
        revokedAt: null,
      })

      await expect(service.refreshSession('stolen-token')).rejects.toMatchObject({
        statusCode: 401,
      })
      expect(mockedRepository.revokeRefreshFamily).toHaveBeenCalledWith('fam-1')
      expect(mockedRepository.bumpSessionVersion).toHaveBeenCalledWith(1)
    })

    it('rejects an expired or revoked refresh token without touching the family', async () => {
      mockedRepository.findRefreshToken.mockResolvedValue({
        id: 5,
        accountId: 1,
        familyId: 'fam-1',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        revokedAt: null,
      })

      await expect(service.refreshSession('expired')).rejects.toMatchObject({ statusCode: 401 })
      expect(mockedRepository.revokeRefreshFamily).not.toHaveBeenCalled()
    })
  })

  describe('email verification (decision 151)', () => {
    it('stores a fresh code and sends it via the reused mailer', async () => {
      mockedRepository.findAccountById.mockResolvedValue(account({ emailVerified: false }))

      await service.sendEmailVerification(1)

      expect(mockedRepository.setEmailVerificationCode).toHaveBeenCalledWith(
        1,
        expect.stringMatching(/^\d{6}$/)
      )
    })

    it('is a silent no-op when the account has no email', async () => {
      mockedRepository.findAccountById.mockResolvedValue(account({ email: null }))

      await service.sendEmailVerification(1)

      expect(mockedRepository.setEmailVerificationCode).not.toHaveBeenCalled()
    })

    it('is a silent no-op when the email is already verified', async () => {
      mockedRepository.findAccountById.mockResolvedValue(account({ emailVerified: true }))

      await service.sendEmailVerification(1)

      expect(mockedRepository.setEmailVerificationCode).not.toHaveBeenCalled()
    })

    it('confirms with the right code inside the window', async () => {
      mockedRepository.getEmailVerificationInfo.mockResolvedValue({
        code: '123456',
        ageMinutes: 1,
      })

      await service.confirmEmailVerification(1, '123456')

      expect(mockedRepository.markEmailVerified).toHaveBeenCalledWith(1)
    })

    it('rejects a wrong code and counts the attempt (decision 113 pattern)', async () => {
      mockedRepository.getEmailVerificationInfo.mockResolvedValue({
        code: '123456',
        ageMinutes: 1,
      })

      await expect(service.confirmEmailVerification(1, '000000')).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      })
      expect(mockedRepository.registerEmailVerificationAttempt).toHaveBeenCalledWith(1)
      expect(mockedRepository.markEmailVerified).not.toHaveBeenCalled()
    })

    it('rejects an expired code without counting an attempt against a dead code', async () => {
      mockedRepository.getEmailVerificationInfo.mockResolvedValue({
        code: '123456',
        ageMinutes: 999,
      })

      await expect(service.confirmEmailVerification(1, '123456')).rejects.toMatchObject({
        statusCode: 401,
      })
      expect(mockedRepository.markEmailVerified).not.toHaveBeenCalled()
    })

    it('rejects when there is no code pending, without ever calling attempt bookkeeping', async () => {
      mockedRepository.getEmailVerificationInfo.mockResolvedValue({
        code: null,
        ageMinutes: 0,
      })

      await expect(service.confirmEmailVerification(1, '123456')).rejects.toMatchObject({
        statusCode: 401,
      })
      expect(mockedRepository.registerEmailVerificationAttempt).not.toHaveBeenCalled()
    })
  })

  describe('verification gate (decision 123)', () => {
    it('blocks a consequential action while neither email nor phone is verified', async () => {
      mockedRepository.findAccountById.mockResolvedValue(account())

      await expect(service.assertVerifiedForConsequentialAction(1)).rejects.toMatchObject({
        statusCode: 403,
        params: { reason: 'verification_required' },
      })
    })

    it('lets it through once either channel is verified', async () => {
      mockedRepository.findAccountById.mockResolvedValue(account({ phoneVerified: true }))
      await expect(service.assertVerifiedForConsequentialAction(1)).resolves.toBeUndefined()

      mockedRepository.findAccountById.mockResolvedValue(account({ emailVerified: true }))
      await expect(service.assertVerifiedForConsequentialAction(1)).resolves.toBeUndefined()
    })
  })
})
