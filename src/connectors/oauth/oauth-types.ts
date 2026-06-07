export type OAuthGrantType = 'authorization_code' | 'refresh_token'

export interface OAuthProviderConfig {
  providerId: string
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  redirectUri: string
  additionalAuthorizeParams?: Record<string, string>
}

export interface OAuthState {
  stateId: string
  providerId: string
  connectorType: string
  codeVerifier: string
  redirectUri: string
  createdAt: string
  expiresAt: string
  used: boolean
  userId: string
}

export interface AuthorizationRequest {
  authorizeUrl: string
  stateId: string
  codeVerifier: string
  codeChallenge: string
  expiresAt: string
}

export interface TokenExchangeResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  tokenType?: string
  scope?: string
  /** Serialized+encrypted auth state for storage in authStateRef */
  encryptedAuthState: string
}

export interface OAuthTokenData {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  tokenType: string
  scope?: string
  providerId: string
  obtainedAt: string
}
