import { OAuthService } from './oauth-service.js';
import { deserializeEncryptedSecret, decryptSecret } from '../../storage/provider-crypto.js';
import type { OAuthProviderConfig, OAuthTokenData } from './oauth-types.js';

export interface RefreshResult {
  success: true;
  oldEncryptedAuthState: string;
  newEncryptedAuthState: string;
  accessToken: string;
  expiresIn?: number;
}

export interface RefreshFailure {
  success: false;
  error: string;
  code: 'TOKEN_EXPIRED_PERMANENTLY' | 'REFRESH_FAILED' | 'NO_REFRESH_TOKEN' | 'STORE_ERROR';
  oldEncryptedAuthState: string;
}

export type RefreshResponse = RefreshResult | RefreshFailure;

export class OAuthRefreshManager {
  constructor(private oauthService: OAuthService) {}

  private decryptAuthState(encryptedAuthState: string): OAuthTokenData {
    const encrypted = deserializeEncryptedSecret(encryptedAuthState);
    const decrypted = decryptSecret(encrypted.encrypted, encrypted.iv, encrypted.authTag);
    return JSON.parse(decrypted) as OAuthTokenData;
  }

  /**
   * Check if stored tokens need refresh and refresh them if needed.
   * @param bufferSeconds - Seconds before expiry to trigger refresh (default 300 = 5 min)
   */
  async refreshIfNeeded(
    config: OAuthProviderConfig,
    encryptedAuthState: string,
    bufferSeconds: number = 300
  ): Promise<RefreshResponse> {
    let tokenData: OAuthTokenData;
    try {
      tokenData = this.decryptAuthState(encryptedAuthState);
    } catch (error) {
      return {
        success: false,
        error: `Failed to decrypt stored tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'STORE_ERROR',
        oldEncryptedAuthState: encryptedAuthState,
      };
    }

    if (tokenData.expiresAt) {
      const expiryTime = new Date(tokenData.expiresAt).getTime();
      if (Date.now() + bufferSeconds * 1000 <= expiryTime) {
        return {
          success: true,
          oldEncryptedAuthState: encryptedAuthState,
          newEncryptedAuthState: encryptedAuthState,
          accessToken: tokenData.accessToken,
          expiresIn: Math.floor((expiryTime - Date.now()) / 1000),
        };
      }
    } else {
      return {
        success: true,
        oldEncryptedAuthState: encryptedAuthState,
        newEncryptedAuthState: encryptedAuthState,
        accessToken: tokenData.accessToken,
      };
    }

    if (!tokenData.refreshToken) {
      return {
        success: false,
        error: 'No refresh token available. Re-authentication required.',
        code: 'NO_REFRESH_TOKEN',
        oldEncryptedAuthState: encryptedAuthState,
      };
    }

    try {
      const result = await this.oauthService.refreshAccessToken(config, tokenData.refreshToken);
      return {
        success: true,
        oldEncryptedAuthState: encryptedAuthState,
        newEncryptedAuthState: result.encryptedAuthState,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      };
    } catch (error) {
      return {
        success: false,
        error: `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'REFRESH_FAILED',
        oldEncryptedAuthState: encryptedAuthState,
      };
    }
  }

  async forceRefresh(
    config: OAuthProviderConfig,
    encryptedAuthState: string
  ): Promise<RefreshResponse> {
    let tokenData: OAuthTokenData;
    try {
      tokenData = this.decryptAuthState(encryptedAuthState);
    } catch (error) {
      return {
        success: false,
        error: `Failed to decrypt stored tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'STORE_ERROR',
        oldEncryptedAuthState: encryptedAuthState,
      };
    }

    if (!tokenData.refreshToken) {
      return {
        success: false,
        error: 'No refresh token available',
        code: 'NO_REFRESH_TOKEN',
        oldEncryptedAuthState: encryptedAuthState,
      };
    }

    try {
      const result = await this.oauthService.refreshAccessToken(config, tokenData.refreshToken);
      return {
        success: true,
        oldEncryptedAuthState: encryptedAuthState,
        newEncryptedAuthState: result.encryptedAuthState,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      };
    } catch (error) {
      return {
        success: false,
        error: `Force refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'REFRESH_FAILED',
        oldEncryptedAuthState: encryptedAuthState,
      };
    }
  }

  /**
   * Revoke a token by contacting the provider's revocation endpoint.
   * Note: Most OAuth providers support token revocation at:
   *   {tokenUrl.replace('/token', '/revoke')}
   */
  async revokeToken(
    config: OAuthProviderConfig,
    encryptedAuthState: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const tokenData = this.decryptAuthState(encryptedAuthState);

      const revokeUrl = config.tokenUrl.replace('/token', '/revoke');

      const body = new URLSearchParams({
        token: tokenData.accessToken,
        ...(tokenData.refreshToken ? { token_type_hint: 'access_token' } : {}),
      });

      const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      // OAuth revocation typically returns 200 OK regardless
      return { success: response.ok };
    } catch (error) {
      return {
        success: false,
        error: `Token revocation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
