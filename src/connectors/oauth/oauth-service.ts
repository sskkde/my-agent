import type { OAuthProviderConfig, AuthorizationRequest, TokenExchangeResult, OAuthTokenData } from './oauth-types.js'
import { OAuthStateManager } from './oauth-state.js'
import { encryptSecret, serializeEncryptedSecret } from '../../storage/provider-crypto.js'

export class OAuthService {
  private stateManager: OAuthStateManager

  constructor() {
    this.stateManager = new OAuthStateManager()
  }

  destroy(): void {
    this.stateManager.destroy()
  }

  getStateManager(): OAuthStateManager {
    return this.stateManager
  }

  generateAuthorizationUrl(config: OAuthProviderConfig, userId: string): AuthorizationRequest {
    const { codeVerifier, codeChallenge } = this.stateManager.generatePkce()

    const state = this.stateManager.createState({
      providerId: config.providerId,
      connectorType: config.providerId,
      codeVerifier,
      redirectUri: config.redirectUri,
      userId,
    })

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state: state.stateId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    if (config.additionalAuthorizeParams) {
      for (const [key, value] of Object.entries(config.additionalAuthorizeParams)) {
        params.set(key, value)
      }
    }

    const authorizeUrl = `${config.authorizeUrl}?${params.toString()}`

    return {
      authorizeUrl,
      stateId: state.stateId,
      codeVerifier,
      codeChallenge,
      expiresAt: state.expiresAt,
    }
  }

  async exchangeCode(
    config: OAuthProviderConfig,
    code: string,
    _stateId: string,
    codeVerifier: string,
  ): Promise<TokenExchangeResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    })

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Token exchange failed: ${response.status} ${errorBody}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      scope?: string
    }

    const tokenData: OAuthTokenData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
      providerId: config.providerId,
      obtainedAt: new Date().toISOString(),
    }

    const encrypted = encryptSecret(JSON.stringify(tokenData))
    const encryptedAuthState = serializeEncryptedSecret(encrypted)

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope,
      encryptedAuthState,
    }
  }

  async refreshAccessToken(config: OAuthProviderConfig, refreshToken: string): Promise<TokenExchangeResult> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    })

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Token refresh failed: ${response.status} ${errorBody}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      scope?: string
    }

    const tokenData: OAuthTokenData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
      providerId: config.providerId,
      obtainedAt: new Date().toISOString(),
    }

    const encrypted = encryptSecret(JSON.stringify(tokenData))
    const encryptedAuthState = serializeEncryptedSecret(encrypted)

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope,
      encryptedAuthState,
    }
  }
}
