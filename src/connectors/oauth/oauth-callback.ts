import { createHash } from 'crypto';
import { OAuthService } from './oauth-service.js';
import { OAuthStateManager } from './oauth-state.js';
import { deserializeEncryptedSecret, decryptSecret } from '../../storage/provider-crypto.js';
import type { OAuthProviderConfig, OAuthTokenData } from './oauth-types.js';

/** Result of a successful OAuth callback */
export interface CallbackResult {
  success: true;
  connectorType: string;
  providerId: string;
  userId: string;
  encryptedAuthState: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/** Result of a failed OAuth callback */
export interface CallbackError {
  success: false;
  error: string;
  code: 'INVALID_STATE' | 'STATE_EXPIRED' | 'STATE_USED' | 'PKCE_MISMATCH' | 'TOKEN_EXCHANGE_FAILED' | 'MISSING_CONFIG';
}

export type CallbackResponse = CallbackResult | CallbackError;

export class OAuthCallbackHandler {
  constructor(
    private oauthService: OAuthService,
    private stateManager: OAuthStateManager
  ) {}

  /**
   * Handle the OAuth callback from the provider.
   *
   * Steps:
   * 1. Look up the state from the stateId parameter
   * 2. Validate state is valid (not expired, not already used)
   * 3. Verify PKCE code_verifier against stored code_challenge
   * 4. Exchange the authorization code for tokens
   * 5. Return the encrypted auth state for storage
   */
  async handleCallback(
    config: OAuthProviderConfig,
    code: string,
    stateId: string,
    codeVerifier: string
  ): Promise<CallbackResponse> {
    // Step 1-2: Consume and validate state
    const state = this.stateManager.consumeState(stateId);
    if (!state) {
      return {
        success: false,
        error: 'Invalid or expired state parameter',
        code: 'INVALID_STATE',
      };
    }

    // Step 3: Verify PKCE
    const storedChallenge = createHash('sha256')
      .update(state.codeVerifier)
      .digest('base64url');
    if (!this.stateManager.verifyPkce(codeVerifier, storedChallenge)) {
      return {
        success: false,
        error: 'PKCE code_verifier does not match stored code_challenge',
        code: 'PKCE_MISMATCH',
      };
    }

    // Step 4: Exchange code for tokens
    try {
      const tokenResult = await this.oauthService.exchangeCode(config, code, stateId, codeVerifier);

      return {
        success: true,
        connectorType: state.connectorType,
        providerId: config.providerId,
        userId: state.userId,
        encryptedAuthState: tokenResult.encryptedAuthState,
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
        expiresIn: tokenResult.expiresIn,
      };
    } catch (error) {
      return {
        success: false,
        error: `Token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'TOKEN_EXCHANGE_FAILED',
      };
    }
  }

  decryptStoredTokens(encryptedAuthState: string): OAuthTokenData {
    const encrypted = deserializeEncryptedSecret(encryptedAuthState);
    const decrypted = decryptSecret(encrypted.encrypted, encrypted.iv, encrypted.authTag);
    return JSON.parse(decrypted) as OAuthTokenData;
  }

  isTokenExpired(tokenData: OAuthTokenData, bufferSeconds: number = 300): boolean {
    if (!tokenData.expiresAt) return false;
    const expiryTime = new Date(tokenData.expiresAt).getTime();
    return Date.now() + bufferSeconds * 1000 > expiryTime;
  }
}
