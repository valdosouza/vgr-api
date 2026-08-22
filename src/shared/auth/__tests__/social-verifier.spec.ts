import { verifyProviderToken } from '@shared/auth/social-verifier'

const mockVerifyIdToken = jest.fn()

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}))

describe('social-verifier', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...OLD_ENV }
    mockVerifyIdToken.mockReset()
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  describe('google', () => {
    it('fails closed (NOT_AVAILABLE) when no client id is configured', async () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID

      await expect(verifyProviderToken('google', 'some-token')).rejects.toMatchObject({
        statusCode: 422,
        code: 'NOT_AVAILABLE',
      })
    })

    it('returns a minimized, already-verified identity on a valid token', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id.apps.googleusercontent.com'
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-sub-1',
          email: 'ana@example.com',
          email_verified: true,
          name: 'Ana',
          // Deliberately extra fields the domain must never see (decision 110/119).
          picture: 'https://example.com/photo.jpg',
        }),
      })

      const identity = await verifyProviderToken('google', 'raw-token')

      expect(identity).toEqual({
        provider: 'google',
        sub: 'google-sub-1',
        email: 'ana@example.com',
        emailVerified: true,
        displayName: 'Ana',
        isPrivateRelayEmail: false,
      })
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'raw-token',
        audience: 'client-id.apps.googleusercontent.com',
      })
    })

    it('rejects (401 UNAUTHORIZED), never leaks the underlying error, when verification throws', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id.apps.googleusercontent.com'
      mockVerifyIdToken.mockRejectedValue(new Error('Wrong number of segments'))

      await expect(verifyProviderToken('google', 'garbage')).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      })
    })

    it('rejects an empty payload the same generic way', async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id.apps.googleusercontent.com'
      mockVerifyIdToken.mockResolvedValue({ getPayload: () => undefined })

      await expect(verifyProviderToken('google', 'raw-token')).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      })
    })
  })

  describe('not built yet (decision 152)', () => {
    it('apple answers NOT_AVAILABLE', async () => {
      await expect(verifyProviderToken('apple', 'x')).rejects.toMatchObject({
        statusCode: 422,
        code: 'NOT_AVAILABLE',
      })
    })

    it('facebook answers NOT_AVAILABLE', async () => {
      await expect(verifyProviderToken('facebook', 'x')).rejects.toMatchObject({
        statusCode: 422,
        code: 'NOT_AVAILABLE',
      })
    })
  })
})
