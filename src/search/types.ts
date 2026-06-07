/**
 * Runtime-safe types and interfaces for web search providers.
 */

export type ProviderName = 'searxng' | 'tavily' | 'remote' | 'playwright' | 'duckduckgo-browser' | 'custom' | 'none'

export type SearchBackend = 'auto' | 'searxng' | 'tavily' | 'remote' | 'playwright' | 'auto-browser' | 'none'

export type SearchErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'SEARCH_FAILED'
  | 'INVALID_ENDPOINT'
  | 'BROWSER_SEARCH_CAPTCHA'
  | 'BROWSER_SEARCH_UNAVAILABLE'

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
  source?: string
}

export interface WebSearchResult {
  query: string
  results: WebSearchResultItem[]
  total: number
  provider: ProviderName | string
  endpointHost: string
}

export interface SearchBackendResult {
  selectedBackend: SearchBackend
  errorCode?: SearchErrorCode
  baseUrl?: string
}

export interface SearchDiagnostics {
  provider: ProviderName
  endpointHost: string
  responseTimeMs?: number
  resultCount: number
}

export interface SearchBackendConfig {
  backend: SearchBackend
  searxngBaseUrl?: string
  tavilyApiKey?: string
  remoteApiUrl?: string
}

export interface ProviderErrorResponse {
  error: string
  code: string
  retry_after?: number
}

export interface BrowserSearchResult {
  success: boolean
  results?: WebSearchResultItem[]
  provider?: ProviderName
  endpointHost?: string
  errorCode?: SearchErrorCode
  query?: string
  total?: number
}
