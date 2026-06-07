import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OAuthService } from '../../../src/connectors/oauth/oauth-service.js'
import { OAuthCallbackHandler } from '../../../src/connectors/oauth/oauth-callback.js'
import { OAuthRefreshManager } from '../../../src/connectors/oauth/oauth-refresh.js'
import { encryptSecret, serializeEncryptedSecret } from '../../../src/storage/provider-crypto.js'
import type { OAuthProviderConfig, OAuthTokenData } from '../../../src/connectors/oauth/oauth-types.js'

const TEST_ENCRYPTION_KEY = 'test-key-for-oauth-integration-tests-min-32-chars!!'

const testConfig: OAuthProviderConfig = {
  providerId: 'google',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/calendar'],
  redirectUri: 'http://localhost:3003/api/v1/connectors/calendar/oauth/callback',
}

function makeEncryptedAuthState(tokenData: OAuthTokenData): string {
  const encrypted = encryptSecret(JSON.stringify(tokenData))
  return serializeEncryptedSecret(encrypted)
}

function makeValidTokenData(overrides?: Partial<OAuthTokenData>): OAuthTokenData {
  return {
    accessToken: 'ya29.initial-token',
    refreshToken: '1//initial-refresh',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    tokenType: 'Bearer',
    scope: 'https://www.googleapis.com/auth/calendar',
    providerId: 'google',
    obtainedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeExpiredTokenData(overrides?: Partial<OAuthTokenData>): OAuthTokenData {
  return makeValidTokenData({
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  })
}

function makeBufferExpiredTokenData(overrides?: Partial<OAuthTokenData>): OAuthTokenData {
  return makeValidTokenData({
    expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    ...overrides,
  })
}

function mockTokenExchangeFetch(overrides?: {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      access_token: 'ya29.new-access-token',
      refresh_token: '1//new-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/calendar',
      ...overrides,
    }),
  })
}

function mockRevokeFetch(ok: boolean = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 400 })
}

describe('OAuth Full Flow Integration', () => {
  let oauthService: OAuthService
  let callbackHandler: OAuthCallbackHandler
  let refreshManager: OAuthRefreshManager
  let originalFetch: typeof globalThis.fetch
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, APP_SECRET_KEY: TEST_ENCRYPTION_KEY }
    oauthService = new OAuthService()
    callbackHandler = new OAuthCallbackHandler(oauthService, oauthService.getStateManager())
    refreshManager = new OAuthRefreshManager(oauthService)
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    oauthService.destroy()
    globalThis.fetch = originalFetch
    process.env = originalEnv
  })

  // ─── A. Complete OAuth Lifecycle ──────────────────────────────────

  describe('A. Complete OAuth Lifecycle', () => {
    it('1. authorize: should generate valid authorization URL with all required params', () => {
      const result = oauthService.generateAuthorizationUrl(testConfig, 'user-123')

      const url = new URL(result.authorizeUrl)
      expect(url.searchParams.get('client_id')).toBe('test-client-id')
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3003/api/v1/connectors/calendar/oauth/callback',
      )
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('state')).toBeDefined()
      expect(url.searchParams.get('code_challenge')).toBeDefined()
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar')

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      expect(result.stateId).toMatch(uuidRegex)

      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now())

      expect(result.codeVerifier).toBeDefined()
      expect(result.codeChallenge).toBeDefined()
      expect(result.codeVerifier.length).toBeGreaterThan(0)
      expect(result.codeChallenge.length).toBeGreaterThan(0)
    })

    it('2. callback: should exchange code for tokens and produce decryptable encryptedAuthState', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123')

      globalThis.fetch = mockTokenExchangeFetch({
        access_token: 'ya29.initial-access',
        refresh_token: '1//initial-refresh',
        expires_in: 3600,
      })

      const result = await callbackHandler.handleCallback(
        testConfig,
        'auth-code-123',
        authRequest.stateId,
        authRequest.codeVerifier,
      )

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.accessToken).toBe('ya29.initial-access')
      expect(result.refreshToken).toBe('1//initial-refresh')
      expect(result.encryptedAuthState).toBeDefined()
      expect(result.encryptedAuthState).toContain('aes-256-gcm:')

      const decrypted = callbackHandler.decryptStoredTokens(result.encryptedAuthState)
      expect(decrypted.accessToken).toBe('ya29.initial-access')
      expect(decrypted.refreshToken).toBe('1//initial-refresh')
      expect(decrypted.tokenType).toBe('Bearer')
      expect(decrypted.providerId).toBe('google')
      expect(decrypted.expiresAt).toBeDefined()
      expect(decrypted.obtainedAt).toBeDefined()
    })

    it('3. refresh: should refresh expired token and produce new encryptedAuthState', async () => {
      const expiredData = makeExpiredTokenData()
      const oldEncrypted = makeEncryptedAuthState(expiredData)

      globalThis.fetch = mockTokenExchangeFetch({
        access_token: 'ya29.refreshed-token',
        refresh_token: '1//refreshed-refresh',
        expires_in: 3600,
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, oldEncrypted)

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.accessToken).toBe('ya29.refreshed-token')
      expect(result.newEncryptedAuthState).not.toBe(oldEncrypted)
      expect(result.oldEncryptedAuthState).toBe(oldEncrypted)

      const decrypted = callbackHandler.decryptStoredTokens(result.newEncryptedAuthState)
      expect(decrypted.accessToken).toBe('ya29.refreshed-token')
      expect(decrypted.refreshToken).toBe('1//refreshed-refresh')
    })

    it('4. revoke: should successfully revoke a token', async () => {
      const tokenData = makeValidTokenData()
      const encrypted = makeEncryptedAuthState(tokenData)

      globalThis.fetch = mockRevokeFetch(true)

      const result = await refreshManager.revokeToken(testConfig, encrypted)

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()

      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toBe('https://oauth2.googleapis.com/revoke')
      expect(options.method).toBe('POST')
    })
  })

  // ─── B. Expired Token Scenarios ───────────────────────────────────

  describe('B. Expired Token Scenarios', () => {
    it('5. token expiry within buffer window triggers auto-refresh', async () => {
      const bufferData = makeBufferExpiredTokenData()
      const encrypted = makeEncryptedAuthState(bufferData)

      globalThis.fetch = mockTokenExchangeFetch({
        access_token: 'ya29.auto-refreshed',
        expires_in: 3600,
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, encrypted)

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.newEncryptedAuthState).not.toBe(encrypted)
      expect(result.accessToken).toBe('ya29.auto-refreshed')
    })

    it('6. token still valid (outside buffer) does NOT trigger refresh', async () => {
      const validData = makeValidTokenData()
      const encrypted = makeEncryptedAuthState(validData)

      const result = await refreshManager.refreshIfNeeded(testConfig, encrypted)

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.newEncryptedAuthState).toBe(encrypted)
      expect(result.accessToken).toBe('ya29.initial-token')
    })

    it('7. token with no expiresAt is treated as never-expiring (no refresh)', async () => {
      const noExpiryData: OAuthTokenData = {
        accessToken: 'ya29.no-expiry',
        refreshToken: '1//no-expiry-refresh',
        tokenType: 'Bearer',
        scope: 'https://www.googleapis.com/auth/calendar',
        providerId: 'google',
        obtainedAt: new Date().toISOString(),
      }
      const encrypted = makeEncryptedAuthState(noExpiryData)

      const result = await refreshManager.refreshIfNeeded(testConfig, encrypted)

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.newEncryptedAuthState).toBe(encrypted)
      expect(result.accessToken).toBe('ya29.no-expiry')
    })
  })

  // ─── C. Error Scenarios ───────────────────────────────────────────

  describe('C. Error Scenarios', () => {
    it('8. invalid state parameter returns INVALID_STATE', async () => {
      const result = await callbackHandler.handleCallback(
        testConfig,
        'auth-code',
        'non-existent-state-id',
        'some-verifier',
      )

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('INVALID_STATE')
    })

    it('9. expired state (TTL elapsed) returns INVALID_STATE', async () => {
      const shortTtlService = new OAuthService()
      const { OAuthStateManager } = await import('../../../src/connectors/oauth/oauth-state.js')
      const shortTtlManager = new OAuthStateManager(1)
      const state = shortTtlManager.createState({
        providerId: 'google',
        connectorType: 'google',
        codeVerifier: 'test-verifier',
        redirectUri: testConfig.redirectUri,
        userId: 'user-123',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      const handler = new OAuthCallbackHandler(shortTtlService, shortTtlManager)

      const result = await handler.handleCallback(testConfig, 'auth-code', state.stateId, 'test-verifier')

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('INVALID_STATE')

      shortTtlService.destroy()
      shortTtlManager.destroy()
    })

    it('10. wrong PKCE code_verifier returns PKCE_MISMATCH', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123')

      const result = await callbackHandler.handleCallback(
        testConfig,
        'auth-code',
        authRequest.stateId,
        'wrong-code-verifier',
      )

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('PKCE_MISMATCH')
    })

    it('11. no refresh token returns NO_REFRESH_TOKEN', async () => {
      const expiredNoRefresh: OAuthTokenData = {
        accessToken: 'ya29.expired-no-refresh',
        tokenType: 'Bearer',
        scope: 'https://www.googleapis.com/auth/calendar',
        providerId: 'google',
        obtainedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }
      const encrypted = makeEncryptedAuthState(expiredNoRefresh)

      const result = await refreshManager.refreshIfNeeded(testConfig, encrypted)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('NO_REFRESH_TOKEN')
    })

    it('12. corrupted encryptedAuthState returns STORE_ERROR', async () => {
      const corrupted = 'not-a-valid-encrypted-state-at-all'

      const result = await refreshManager.refreshIfNeeded(testConfig, corrupted)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('STORE_ERROR')
    })
  })

  // ─── D. Concurrent Access (Security) ──────────────────────────────

  describe('D. Concurrent Access (Security)', () => {
    it('13. replay attack prevention: consuming same state twice returns null on second call', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123')

      globalThis.fetch = mockTokenExchangeFetch()

      const firstResult = await callbackHandler.handleCallback(
        testConfig,
        'auth-code-1',
        authRequest.stateId,
        authRequest.codeVerifier,
      )
      expect(firstResult.success).toBe(true)

      const secondResult = await callbackHandler.handleCallback(
        testConfig,
        'auth-code-2',
        authRequest.stateId,
        authRequest.codeVerifier,
      )
      expect(secondResult.success).toBe(false)
      if (secondResult.success) return
      expect(secondResult.code).toBe('INVALID_STATE')
    })

    it('14. concurrent state isolation: two independent states consumed independently', async () => {
      const auth1 = oauthService.generateAuthorizationUrl(testConfig, 'user-1')
      const auth2 = oauthService.generateAuthorizationUrl(testConfig, 'user-2')

      let callCount = 0
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: `ya29.token-${++callCount}`,
          refresh_token: `1//refresh-${callCount}`,
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const result1 = await callbackHandler.handleCallback(testConfig, 'auth-code-1', auth1.stateId, auth1.codeVerifier)
      expect(result1.success).toBe(true)

      const result2 = await callbackHandler.handleCallback(testConfig, 'auth-code-2', auth2.stateId, auth2.codeVerifier)
      expect(result2.success).toBe(true)

      if (!result1.success || !result2.success) return
      expect(result1.userId).toBe('user-1')
      expect(result2.userId).toBe('user-2')
      expect(result1.encryptedAuthState).not.toBe(result2.encryptedAuthState)
    })

    it('15. race condition: two simultaneous callbacks with same state — only first succeeds', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123')

      globalThis.fetch = mockTokenExchangeFetch()

      const [result1, result2] = await Promise.all([
        callbackHandler.handleCallback(testConfig, 'auth-code-1', authRequest.stateId, authRequest.codeVerifier),
        callbackHandler.handleCallback(testConfig, 'auth-code-2', authRequest.stateId, authRequest.codeVerifier),
      ])

      const successes = [result1, result2].filter((r) => r.success).length
      const failures = [result1, result2].filter((r) => !r.success).length
      expect(successes).toBe(1)
      expect(failures).toBe(1)

      const failure = [result1, result2].find((r) => !r.success)!
      expect(failure.code).toBe('INVALID_STATE')
    })
  })

  // ─── E. Token Refresh Chain ───────────────────────────────────────

  describe('E. Token Refresh Chain', () => {
    it('16. multiple sequential refreshes produce different tokens each time', async () => {
      const expiredData = makeExpiredTokenData()
      let encrypted = makeEncryptedAuthState(expiredData)

      const tokens: string[] = []
      const encryptedStates: string[] = [encrypted]

      for (let i = 0; i < 3; i++) {
        globalThis.fetch = mockTokenExchangeFetch({
          access_token: `ya29.refresh-${i}`,
          refresh_token: `1//refresh-${i}`,
          expires_in: 3600,
        })

        const result = await refreshManager.forceRefresh(testConfig, encrypted)
        expect(result.success).toBe(true)
        if (!result.success) return

        tokens.push(result.accessToken)
        encrypted = result.newEncryptedAuthState
        encryptedStates.push(encrypted)
      }

      expect(new Set(tokens).size).toBe(3)
      expect(new Set(encryptedStates).size).toBe(4)

      for (let i = 0; i < encryptedStates.length; i++) {
        const decrypted = callbackHandler.decryptStoredTokens(encryptedStates[i])
        if (i === 0) {
          expect(decrypted.accessToken).toBe('ya29.initial-token')
        } else {
          expect(decrypted.accessToken).toBe(`ya29.refresh-${i - 1}`)
        }
      }
    })

    it('17. force refresh on a valid token still produces new tokens', async () => {
      const validData = makeValidTokenData()
      const encrypted = makeEncryptedAuthState(validData)

      globalThis.fetch = mockTokenExchangeFetch({
        access_token: 'ya29.forced-refresh',
        refresh_token: '1//forced-refresh',
        expires_in: 3600,
      })

      const result = await refreshManager.forceRefresh(testConfig, encrypted)

      expect(result.success).toBe(true)
      if (!result.success) return

      expect(result.accessToken).toBe('ya29.forced-refresh')
      expect(result.newEncryptedAuthState).not.toBe(encrypted)

      const decrypted = callbackHandler.decryptStoredTokens(result.newEncryptedAuthState)
      expect(decrypted.accessToken).toBe('ya29.forced-refresh')
    })
  })
})
