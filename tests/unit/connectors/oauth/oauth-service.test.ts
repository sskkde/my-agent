import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthStateManager } from '../../../../src/connectors/oauth/oauth-state.js';
import { OAuthService } from '../../../../src/connectors/oauth/oauth-service.js';
import type { OAuthProviderConfig } from '../../../../src/connectors/oauth/oauth-types.js';
import { createHash } from 'crypto';

const TEST_ENCRYPTION_KEY = 'test-secret-key-for-oauth-encryption-32';

describe('OAuthStateManager', () => {
  let manager: OAuthStateManager;

  beforeEach(() => {
    manager = new OAuthStateManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('generatePkce', () => {
    it('should generate valid code_verifier and code_challenge', () => {
      const { codeVerifier, codeChallenge } = manager.generatePkce();

      expect(codeVerifier).toBeDefined();
      expect(codeChallenge).toBeDefined();
      expect(codeVerifier.length).toBeGreaterThan(0);
      expect(codeChallenge.length).toBeGreaterThan(0);
    });

    it('should produce S256 code_challenge from code_verifier', () => {
      const { codeVerifier, codeChallenge } = manager.generatePkce();

      const expected = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      expect(codeChallenge).toBe(expected);
    });

    it('should generate unique values each call', () => {
      const first = manager.generatePkce();
      const second = manager.generatePkce();

      expect(first.codeVerifier).not.toBe(second.codeVerifier);
      expect(first.codeChallenge).not.toBe(second.codeChallenge);
    });
  });

  describe('createState', () => {
    it('should store state with correct fields', () => {
      const { codeVerifier } = manager.generatePkce();
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier,
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      });

      expect(state.stateId).toBeDefined();
      expect(state.providerId).toBe('google');
      expect(state.connectorType).toBe('calendar');
      expect(state.codeVerifier).toBe(codeVerifier);
      expect(state.redirectUri).toBe('http://localhost:3003/callback');
      expect(state.userId).toBe('user-123');
      expect(state.used).toBe(false);
      expect(state.createdAt).toBeDefined();
      expect(state.expiresAt).toBeDefined();
    });

    it('should set expiresAt 10 minutes from now by default', () => {
      const before = Date.now();
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      });
      const after = Date.now();

      const expiresAt = new Date(state.expiresAt).getTime();
      const tenMinutes = 10 * 60 * 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(before + tenMinutes);
      expect(expiresAt).toBeLessThanOrEqual(after + tenMinutes);
    });

    it('should respect custom TTL', () => {
      const customManager = new OAuthStateManager(5 * 60 * 1000);
      const state = customManager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      });

      const expiresAt = new Date(state.expiresAt).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      const now = Date.now();

      expect(expiresAt).toBeGreaterThanOrEqual(now + fiveMinutes - 1000);
      expect(expiresAt).toBeLessThanOrEqual(now + fiveMinutes + 1000);

      customManager.destroy();
    });
  });

  describe('consumeState', () => {
    it('should return valid state on first consumption', () => {
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      });

      const consumed = manager.consumeState(state.stateId);

      expect(consumed).not.toBeNull();
      expect(consumed!.stateId).toBe(state.stateId);
      expect(consumed!.used).toBe(true);
    });

    it('should return null for already used state (one-time use)', () => {
      const state = manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      });

      manager.consumeState(state.stateId);
      const second = manager.consumeState(state.stateId);

      expect(second).toBeNull();
    });

    it('should return null for expired state', () => {
      const shortManager = new OAuthStateManager(-1);
      const state = shortManager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      });

      const consumed = shortManager.consumeState(state.stateId);

      expect(consumed).toBeNull();
      shortManager.destroy();
    });

    it('should return null for non-existent state', () => {
      const consumed = manager.consumeState('non-existent-id');

      expect(consumed).toBeNull();
    });
  });

  describe('verifyPkce', () => {
    it('should pass for matching code_verifier/code_challenge', () => {
      const { codeVerifier, codeChallenge } = manager.generatePkce();

      expect(manager.verifyPkce(codeVerifier, codeChallenge)).toBe(true);
    });

    it('should fail for wrong code_verifier', () => {
      const { codeChallenge } = manager.generatePkce();

      expect(manager.verifyPkce('wrong-verifier', codeChallenge)).toBe(false);
    });

    it('should fail for wrong code_challenge', () => {
      const { codeVerifier } = manager.generatePkce();

      expect(manager.verifyPkce(codeVerifier, 'wrong-challenge')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired states', () => {
      const shortManager = new OAuthStateManager(-1);
      shortManager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-123',
      });

      expect(shortManager.getActiveCount()).toBe(1);

      shortManager.cleanup();

      expect(shortManager.getActiveCount()).toBe(0);
      shortManager.destroy();
    });
  });

  describe('getActiveCount', () => {
    it('should return correct count', () => {
      expect(manager.getActiveCount()).toBe(0);

      manager.createState({
        providerId: 'google',
        connectorType: 'calendar',
        codeVerifier: 'test1',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-1',
      });

      expect(manager.getActiveCount()).toBe(1);

      manager.createState({
        providerId: 'google',
        connectorType: 'contacts',
        codeVerifier: 'test2',
        redirectUri: 'http://localhost:3003/callback',
        userId: 'user-2',
      });

      expect(manager.getActiveCount()).toBe(2);
    });
  });
});

describe('OAuthService', () => {
  let service: OAuthService;
  const originalEnv = process.env;

  const testConfig: OAuthProviderConfig = {
    providerId: 'google-calendar',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    redirectUri: 'http://localhost:3003/api/v1/connectors/oauth/callback',
  };

  beforeEach(() => {
    process.env = { ...originalEnv, APP_SECRET_KEY: TEST_ENCRYPTION_KEY };
    service = new OAuthService();
  });

  afterEach(() => {
    service.destroy();
    process.env = originalEnv;
  });

  describe('generateAuthorizationUrl', () => {
    it('should create valid URL with required params', () => {
      const result = service.generateAuthorizationUrl(testConfig, 'user-123');

      expect(result.authorizeUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(result.authorizeUrl).toContain('client_id=test-client-id');
      expect(result.authorizeUrl).toContain('redirect_uri=');
      expect(result.authorizeUrl).toContain('response_type=code');
    });

    it('should include state parameter', () => {
      const result = service.generateAuthorizationUrl(testConfig, 'user-123');

      expect(result.stateId).toBeDefined();
      expect(result.stateId.length).toBeGreaterThan(0);
      expect(result.authorizeUrl).toContain(`state=${result.stateId}`);
    });

    it('should include code_challenge with S256 method', () => {
      const result = service.generateAuthorizationUrl(testConfig, 'user-123');

      expect(result.codeChallenge).toBeDefined();
      expect(result.authorizeUrl).toContain('code_challenge_method=S256');
      expect(result.authorizeUrl).toContain(`code_challenge=${result.codeChallenge}`);
    });

    it('should include all scopes', () => {
      const result = service.generateAuthorizationUrl(testConfig, 'user-123');

      expect(result.authorizeUrl).toContain(
        'scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly'
      );
    });

    it('should include additional authorize params', () => {
      const configWithParams: OAuthProviderConfig = {
        ...testConfig,
        additionalAuthorizeParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      };

      const result = service.generateAuthorizationUrl(configWithParams, 'user-123');

      expect(result.authorizeUrl).toContain('access_type=offline');
      expect(result.authorizeUrl).toContain('prompt=consent');
    });

    it('should store state in state manager', () => {
      const result = service.generateAuthorizationUrl(testConfig, 'user-123');

      const state = service.getStateManager().consumeState(result.stateId);

      expect(state).not.toBeNull();
      expect(state!.codeVerifier).toBe(result.codeVerifier);
      expect(state!.providerId).toBe('google-calendar');
      expect(state!.userId).toBe('user-123');
    });

    it('should set expiresAt on the result', () => {
      const result = service.generateAuthorizationUrl(testConfig, 'user-123');

      expect(result.expiresAt).toBeDefined();
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('exchangeCode', () => {
    it('should throw on HTTP error', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });

      await expect(
        service.exchangeCode(testConfig, 'auth-code', 'state-id', 'verifier')
      ).rejects.toThrow('Token exchange failed: 400 invalid_grant');

      globalThis.fetch = originalFetch;
    });

    it('should return token data on success', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.test-access-token',
          refresh_token: '1//test-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/calendar.readonly',
        }),
      });

      const result = await service.exchangeCode(
        testConfig,
        'auth-code',
        'state-id',
        'verifier'
      );

      expect(result.accessToken).toBe('ya29.test-access-token');
      expect(result.refreshToken).toBe('1//test-refresh-token');
      expect(result.expiresIn).toBe(3600);
      expect(result.tokenType).toBe('Bearer');
      expect(result.encryptedAuthState).toBeDefined();
      expect(result.encryptedAuthState).toContain('aes-256-gcm:');

      globalThis.fetch = originalFetch;
    });

    it('should send correct POST body to token endpoint', async () => {
      const originalFetch = globalThis.fetch;
      let capturedBody: string | null = null;
      let capturedUrl: string | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
        capturedUrl = url as string;
        capturedBody = options?.body as string;
        return {
          ok: true,
          json: async () => ({
            access_token: 'test-token',
            token_type: 'Bearer',
          }),
        };
      });

      await service.exchangeCode(testConfig, 'auth-code-123', 'state-id', 'verifier-abc');

      expect(capturedUrl).toBe('https://oauth2.googleapis.com/token');
      expect(capturedBody).toContain('grant_type=authorization_code');
      expect(capturedBody).toContain('code=auth-code-123');
      expect(capturedBody).toContain('code_verifier=verifier-abc');
      expect(capturedBody).toContain('client_id=test-client-id');
      expect(capturedBody).toContain('client_secret=test-client-secret');

      globalThis.fetch = originalFetch;
    });
  });

  describe('refreshAccessToken', () => {
    it('should throw on HTTP error', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid_token',
      });

      await expect(
        service.refreshAccessToken(testConfig, 'expired-refresh-token')
      ).rejects.toThrow('Token refresh failed: 401 invalid_token');

      globalThis.fetch = originalFetch;
    });

    it('should return new token data on success', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.new-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const result = await service.refreshAccessToken(testConfig, 'valid-refresh-token');

      expect(result.accessToken).toBe('ya29.new-access-token');
      expect(result.expiresIn).toBe(3600);
      expect(result.encryptedAuthState).toBeDefined();

      globalThis.fetch = originalFetch;
    });

    it('should preserve original refresh token if not returned', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'ya29.new-access-token',
          token_type: 'Bearer',
        }),
      });

      const result = await service.refreshAccessToken(testConfig, 'original-refresh-token');

      expect(result.refreshToken).toBeUndefined();

      globalThis.fetch = originalFetch;
    });

    it('should send correct POST body for refresh', async () => {
      const originalFetch = globalThis.fetch;
      let capturedBody: string | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = options?.body as string;
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-token',
            token_type: 'Bearer',
          }),
        };
      });

      await service.refreshAccessToken(testConfig, 'my-refresh-token');

      expect(capturedBody).toContain('grant_type=refresh_token');
      expect(capturedBody).toContain('refresh_token=my-refresh-token');
      expect(capturedBody).toContain('client_id=test-client-id');
      expect(capturedBody).toContain('client_secret=test-client-secret');

      globalThis.fetch = originalFetch;
    });
  });

  describe('destroy', () => {
    it('should clean up state manager', () => {
      const stateManager = service.getStateManager();
      service.generateAuthorizationUrl(testConfig, 'user-123');

      expect(stateManager.getActiveCount()).toBe(1);

      service.destroy();

      expect(stateManager.getActiveCount()).toBe(1);
    });
  });
});
