import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OAuthService } from '../../../../src/connectors/oauth/oauth-service.js'
import { OAuthRefreshManager } from '../../../../src/connectors/oauth/oauth-refresh.js'
import { OAuthCallbackHandler } from '../../../../src/connectors/oauth/oauth-callback.js'
import { encryptSecret, serializeEncryptedSecret } from '../../../../src/storage/provider-crypto.js'
import type { OAuthProviderConfig, OAuthTokenData } from '../../../../src/connectors/oauth/oauth-types.js'

const TEST_ENCRYPTION_KEY = 'test-secret-key-for-oauth-encryption-32'

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
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
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

describe('OAuthRefreshManager', () => {
  let oauthService: OAuthService
  let refreshManager: OAuthRefreshManager
  const originalEnv = process.env
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    process.env = { ...originalEnv, APP_SECRET_KEY: TEST_ENCRYPTION_KEY }
    oauthService = new OAuthService()
    refreshManager = new OAuthRefreshManager(oauthService)
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    oauthService.destroy()
    globalThis.fetch = originalFetch
    process.env = originalEnv
  })

  describe('refreshIfNeeded', () => {
    it('should return immediately if token is still valid', async () => {
      const tokenData = makeValidTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.newEncryptedAuthState).toBe(encryptedAuthState)
      expect(result.oldEncryptedAuthState).toBe(encryptedAuthState)
      expect(result.accessToken).toBe('ya29.test-access-token')
      expect(result.expiresIn).toBeGreaterThan(0)
    })

    it('should auto-refresh when token is expired', async () => {
      const tokenData = makeExpiredTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.refreshed-access-token',
          refresh_token: '1//new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.accessToken).toBe('ya29.refreshed-access-token')
      expect(result.newEncryptedAuthState).not.toBe(encryptedAuthState)
      expect(result.oldEncryptedAuthState).toBe(encryptedAuthState)
      expect(result.expiresIn).toBe(3600)
    })

    it('should auto-refresh when token is within buffer window', async () => {
      const tokenData = makeValidTokenData({
        expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
      })
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.refreshed-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState, 300)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.accessToken).toBe('ya29.refreshed-access-token')
    })

    it('should not refresh when token is outside buffer window', async () => {
      const tokenData = makeValidTokenData({
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      let fetchCalled = false
      globalThis.fetch = vi.fn().mockImplementation(() => {
        fetchCalled = true
        return { ok: true, json: async () => ({}) }
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState, 300)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.newEncryptedAuthState).toBe(encryptedAuthState)
      expect(fetchCalled).toBe(false)
    })

    it('should return NO_REFRESH_TOKEN when no refresh token exists', async () => {
      const tokenData = makeExpiredTokenData({ refreshToken: undefined })
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('NO_REFRESH_TOKEN')
      expect(result.error).toContain('No refresh token')
      expect(result.oldEncryptedAuthState).toBe(encryptedAuthState)
    })

    it('should return STORE_ERROR for corrupted encryptedAuthState', async () => {
      const result = await refreshManager.refreshIfNeeded(testConfig, 'not-valid-encrypted-state')

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('STORE_ERROR')
      expect(result.error).toContain('Failed to decrypt')
      expect(result.oldEncryptedAuthState).toBe('not-valid-encrypted-state')
    })

    it('should return REFRESH_FAILED when HTTP request fails', async () => {
      const tokenData = makeExpiredTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid_token',
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('REFRESH_FAILED')
      expect(result.error).toContain('Token refresh failed')
      expect(result.oldEncryptedAuthState).toBe(encryptedAuthState)
    })

    it('should return REFRESH_FAILED on network error', async () => {
      const tokenData = makeExpiredTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('REFRESH_FAILED')
      expect(result.error).toContain('Network error')
    })

    it('should handle token without expiresAt (never expires)', async () => {
      const tokenData = makeValidTokenData({ expiresAt: undefined })
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.newEncryptedAuthState).toBe(encryptedAuthState)
    })
  })

  describe('forceRefresh', () => {
    it('should refresh regardless of expiry', async () => {
      const tokenData = makeValidTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.forced-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const result = await refreshManager.forceRefresh(testConfig, encryptedAuthState)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.accessToken).toBe('ya29.forced-refresh-token')
      expect(result.newEncryptedAuthState).not.toBe(encryptedAuthState)
    })

    it('should return error when no refresh token', async () => {
      const tokenData = makeValidTokenData({ refreshToken: undefined })
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      const result = await refreshManager.forceRefresh(testConfig, encryptedAuthState)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('NO_REFRESH_TOKEN')
    })

    it('should return STORE_ERROR for corrupted encryptedAuthState', async () => {
      const result = await refreshManager.forceRefresh(testConfig, 'corrupted')

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('STORE_ERROR')
    })

    it('should return REFRESH_FAILED when HTTP request fails', async () => {
      const tokenData = makeValidTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'server error',
      })

      const result = await refreshManager.forceRefresh(testConfig, encryptedAuthState)

      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.code).toBe('REFRESH_FAILED')
      expect(result.error).toContain('Force refresh failed')
    })
  })

  describe('revokeToken', () => {
    it('should succeed with 200 response', async () => {
      const tokenData = makeValidTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })

      const result = await refreshManager.revokeToken(testConfig, encryptedAuthState)

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should fail on HTTP error', async () => {
      const tokenData = makeValidTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      })

      const result = await refreshManager.revokeToken(testConfig, encryptedAuthState)

      expect(result.success).toBe(false)
    })

    it('should fail on network error', async () => {
      const tokenData = makeValidTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

      const result = await refreshManager.revokeToken(testConfig, encryptedAuthState)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection refused')
    })

    it('should send request to revoke endpoint', async () => {
      const tokenData = makeValidTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      let capturedUrl: string | null = null
      let capturedBody: string | null = null

      globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
        capturedUrl = url as string
        capturedBody = options?.body as string
        return { ok: true, status: 200 }
      })

      await refreshManager.revokeToken(testConfig, encryptedAuthState)

      expect(capturedUrl).toBe('https://oauth2.googleapis.com/revoke')
      expect(capturedBody).toContain('token=ya29.test-access-token')
      expect(capturedBody).toContain('token_type_hint=access_token')
    })

    it('should not include token_type_hint when no refresh token', async () => {
      const tokenData = makeValidTokenData({ refreshToken: undefined })
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      let capturedBody: string | null = null

      globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = options?.body as string
        return { ok: true, status: 200 }
      })

      await refreshManager.revokeToken(testConfig, encryptedAuthState)

      expect(capturedBody).toContain('token=ya29.test-access-token')
      expect(capturedBody).not.toContain('token_type_hint')
    })

    it('should fail gracefully for corrupted encryptedAuthState', async () => {
      const result = await refreshManager.revokeToken(testConfig, 'corrupted-state')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Token revocation failed')
    })
  })

  describe('integration: encrypted auth state round-trip', () => {
    it('should produce new encryptedAuthState that can be decrypted', async () => {
      const tokenData = makeExpiredTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.round-trip-token',
          refresh_token: '1//round-trip-refresh',
          expires_in: 7200,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/calendar',
        }),
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(true)
      if (!result.success) return

      const callbackHandler = new OAuthCallbackHandler(oauthService, oauthService.getStateManager())
      const newTokenData = callbackHandler.decryptStoredTokens(result.newEncryptedAuthState)

      expect(newTokenData.accessToken).toBe('ya29.round-trip-token')
      expect(newTokenData.refreshToken).toBe('1//round-trip-refresh')
      expect(newTokenData.tokenType).toBe('Bearer')
      expect(newTokenData.providerId).toBe('google')
    })

    it('should produce different encryptedAuthState after refresh', async () => {
      const tokenData = makeExpiredTokenData()
      const encryptedAuthState = makeEncryptedAuthState(tokenData)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.new-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const result = await refreshManager.refreshIfNeeded(testConfig, encryptedAuthState)

      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.newEncryptedAuthState).not.toBe(result.oldEncryptedAuthState)
      expect(result.newEncryptedAuthState).toContain('aes-256-gcm:')
    })
  })
})
