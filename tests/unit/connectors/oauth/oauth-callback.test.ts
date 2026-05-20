import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthService } from '../../../../src/connectors/oauth/oauth-service.js';
import { OAuthCallbackHandler } from '../../../../src/connectors/oauth/oauth-callback.js';
import type { OAuthProviderConfig } from '../../../../src/connectors/oauth/oauth-types.js';

const TEST_ENCRYPTION_KEY = 'test-secret-key-for-oauth-encryption-32';

const testConfig: OAuthProviderConfig = {
  providerId: 'google',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/calendar'],
  redirectUri: 'http://localhost:3003/api/v1/connectors/calendar/oauth/callback',
};

describe('OAuthCallbackHandler', () => {
  let oauthService: OAuthService;
  let handler: OAuthCallbackHandler;
  const originalEnv = process.env;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, APP_SECRET_KEY: TEST_ENCRYPTION_KEY };
    oauthService = new OAuthService();
    handler = new OAuthCallbackHandler(oauthService, oauthService.getStateManager());
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    oauthService.destroy();
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  describe('handleCallback', () => {
    it('should return success with valid params', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.test-access-token',
          refresh_token: '1//test-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/calendar',
        }),
      });

      const result = await handler.handleCallback(
        testConfig,
        'auth-code-123',
        authRequest.stateId,
        authRequest.codeVerifier
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.connectorType).toBe('google');
      expect(result.providerId).toBe('google');
      expect(result.userId).toBe('user-123');
      expect(result.accessToken).toBe('ya29.test-access-token');
      expect(result.refreshToken).toBe('1//test-refresh-token');
      expect(result.expiresIn).toBe(3600);
      expect(result.encryptedAuthState).toBeDefined();
      expect(result.encryptedAuthState).toContain('aes-256-gcm:');
    });

    it('should return INVALID_STATE for non-existent state', async () => {
      const result = await handler.handleCallback(
        testConfig,
        'auth-code',
        'non-existent-state-id',
        'some-verifier'
      );

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.code).toBe('INVALID_STATE');
      expect(result.error).toContain('Invalid or expired state');
    });

    it('should return INVALID_STATE for already consumed state (replay attack)', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.test-access-token',
          token_type: 'Bearer',
        }),
      });

      await handler.handleCallback(
        testConfig,
        'auth-code',
        authRequest.stateId,
        authRequest.codeVerifier
      );

      const replayResult = await handler.handleCallback(
        testConfig,
        'auth-code',
        authRequest.stateId,
        authRequest.codeVerifier
      );

      expect(replayResult.success).toBe(false);
      if (replayResult.success) return;

      expect(replayResult.code).toBe('INVALID_STATE');
    });

    it('should return PKCE_MISMATCH for wrong code_verifier', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123');

      const result = await handler.handleCallback(
        testConfig,
        'auth-code',
        authRequest.stateId,
        'wrong-code-verifier'
      );

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.code).toBe('PKCE_MISMATCH');
      expect(result.error).toContain('PKCE');
    });

    it('should return TOKEN_EXCHANGE_FAILED when fetch fails', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });

      const result = await handler.handleCallback(
        testConfig,
        'auth-code',
        authRequest.stateId,
        authRequest.codeVerifier
      );

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.code).toBe('TOKEN_EXCHANGE_FAILED');
      expect(result.error).toContain('Token exchange failed');
    });

    it('should return TOKEN_EXCHANGE_FAILED on network error', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123');

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await handler.handleCallback(
        testConfig,
        'auth-code',
        authRequest.stateId,
        authRequest.codeVerifier
      );

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.code).toBe('TOKEN_EXCHANGE_FAILED');
      expect(result.error).toContain('Network error');
    });
  });

  describe('decryptStoredTokens', () => {
    it('should return correct OAuthTokenData', async () => {
      const authRequest = oauthService.generateAuthorizationUrl(testConfig, 'user-123');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.test-access-token',
          refresh_token: '1//test-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/calendar',
        }),
      });

      const callbackResult = await handler.handleCallback(
        testConfig,
        'auth-code',
        authRequest.stateId,
        authRequest.codeVerifier
      );

      expect(callbackResult.success).toBe(true);
      if (!callbackResult.success) return;

      const tokenData = handler.decryptStoredTokens(callbackResult.encryptedAuthState);

      expect(tokenData.accessToken).toBe('ya29.test-access-token');
      expect(tokenData.refreshToken).toBe('1//test-refresh-token');
      expect(tokenData.tokenType).toBe('Bearer');
      expect(tokenData.scope).toBe('https://www.googleapis.com/auth/calendar');
      expect(tokenData.providerId).toBe('google');
      expect(tokenData.obtainedAt).toBeDefined();
      expect(tokenData.expiresAt).toBeDefined();
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired token', () => {
      const tokenData = {
        accessToken: 'test',
        tokenType: 'Bearer',
        providerId: 'google',
        obtainedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };

      expect(handler.isTokenExpired(tokenData)).toBe(true);
    });

    it('should return false for valid token', () => {
      const tokenData = {
        accessToken: 'test',
        tokenType: 'Bearer',
        providerId: 'google',
        obtainedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };

      expect(handler.isTokenExpired(tokenData)).toBe(false);
    });

    it('should return false for token without expiresAt', () => {
      const tokenData = {
        accessToken: 'test',
        tokenType: 'Bearer',
        providerId: 'google',
        obtainedAt: new Date().toISOString(),
      };

      expect(handler.isTokenExpired(tokenData)).toBe(false);
    });

    it('should return true for token within default 5-minute buffer', () => {
      const tokenData = {
        accessToken: 'test',
        tokenType: 'Bearer',
        providerId: 'google',
        obtainedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
      };

      expect(handler.isTokenExpired(tokenData)).toBe(true);
    });

    it('should respect custom buffer', () => {
      const tokenData = {
        accessToken: 'test',
        tokenType: 'Bearer',
        providerId: 'google',
        obtainedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
      };

      expect(handler.isTokenExpired(tokenData, 0)).toBe(false);
      expect(handler.isTokenExpired(tokenData, 5 * 60)).toBe(true);
    });
  });
});
