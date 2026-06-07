import type { ConnectorAdapter, ConnectorCapability, ConnectorCallRequest, ConnectorResponse } from '../types.js'
import type { ConnectorInstance } from '../../storage/connector-store.js'
import type { WebSearchResult, SearchBackend } from '../../search/types.js'
import { resolveSearchBackend } from '../../search/backend-resolver.js'
import { normalizeSearXNGResponse } from '../../search/providers/searxng.js'
import { normalizeTavilyResponse } from '../../search/providers/tavily.js'

export interface RealSearchConnectorConfig {
  fetchImpl?: typeof fetch
  timeout?: number
}

export interface SearchParams {
  query: string
  limit?: number
  source?: 'web' | 'news' | 'all'
}

const DEFAULT_TIMEOUT = 10000
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10

export class RealSearchConnectorAdapter implements ConnectorAdapter {
  private readonly fetchImpl: typeof fetch
  private readonly timeout: number

  constructor(config: RealSearchConnectorConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const { operation, params } = request
    const typedParams = params as unknown as SearchParams

    switch (operation) {
      case 'search':
      case 'web_search':
        return this.webSearch(typedParams, request)
      case 'news_search':
        return this.webSearch({ ...typedParams, source: 'news' }, request)
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  private async webSearch(params: SearchParams, request: ConnectorCallRequest): Promise<ConnectorResponse> {
    const { query, limit = DEFAULT_LIMIT } = params
    const normalizedLimit = Math.max(1, Math.min(limit, MAX_LIMIT))

    if (!query || query.trim() === '') {
      return {
        status: 'failed',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: 'INVALID_QUERY',
          message: 'Search query cannot be empty',
          recoverable: true,
        },
      }
    }

    const backend = this.getBackendFromEnv()
    const searxngBaseUrl = process.env.SEARXNG_BASE_URL
    const tavilyApiKey = process.env.TAVILY_API_KEY
    const tavilyBaseUrl = process.env.TAVILY_BASE_URL
    const remoteApiUrl = process.env.WEB_SEARCH_API_URL
    const remoteApiKey = process.env.WEB_SEARCH_API_KEY

    const backendResult = resolveSearchBackend({
      backend,
      searxngBaseUrl,
      tavilyApiKey,
      remoteApiUrl,
    })

    if (backendResult.selectedBackend === 'none') {
      return {
        status: 'failed',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: backendResult.errorCode ?? 'PROVIDER_NOT_CONFIGURED',
          message: 'No search provider configured',
          recoverable: true,
        },
      }
    }

    let searchResult: WebSearchResult

    try {
      switch (backendResult.selectedBackend) {
        case 'searxng':
          searchResult = await this.fetchWithSearXNG(backendResult.baseUrl!, query, normalizedLimit)
          break

        case 'tavily':
          searchResult = await this.fetchWithTavily(tavilyApiKey!, query, normalizedLimit, tavilyBaseUrl)
          break

        case 'remote':
          searchResult = await this.fetchWithLegacyRemote(backendResult.baseUrl!, remoteApiKey, query, normalizedLimit)
          break

        case 'playwright':
          return {
            status: 'failed',
            requestId: request.requestId,
            connectorInstanceId: request.connectorInstanceId,
            error: {
              code: 'BROWSER_SEARCH_UNAVAILABLE',
              message: 'Playwright browser search is not supported in connector mode',
              recoverable: false,
            },
          }

        default:
          return {
            status: 'failed',
            requestId: request.requestId,
            connectorInstanceId: request.connectorInstanceId,
            error: {
              code: 'PROVIDER_NOT_CONFIGURED',
              message: 'No search provider configured',
              recoverable: true,
            },
          }
      }

      return {
        status: 'success',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        data: searchResult,
      }
    } catch (error) {
      return {
        status: 'failed',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: 'SEARCH_FAILED',
          message: error instanceof Error ? error.message : 'Search failed',
          recoverable: true,
        },
      }
    }
  }

  private getBackendFromEnv(): SearchBackend {
    const backendEnv = process.env.WEB_SEARCH_BACKEND
    if (
      backendEnv === 'searxng' ||
      backendEnv === 'tavily' ||
      backendEnv === 'remote' ||
      backendEnv === 'playwright' ||
      backendEnv === 'auto-browser' ||
      backendEnv === 'none'
    ) {
      return backendEnv
    }
    return 'auto'
  }

  private async fetchWithSearXNG(baseUrl: string, query: string, limit: number): Promise<WebSearchResult> {
    const searchUrl = new URL(baseUrl)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('format', 'json')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this.fetchImpl(searchUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; AgentPlatform/1.0)',
        },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`SearXNG returned HTTP ${response.status}`)
      }

      const payload = await response.json()
      const result = normalizeSearXNGResponse(payload, baseUrl)
      result.results = result.results.slice(0, limit)
      result.total = result.results.length

      return result
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async fetchWithTavily(
    apiKey: string,
    query: string,
    limit: number,
    baseUrl?: string,
  ): Promise<WebSearchResult> {
    const tavilyUrl = baseUrl ?? 'https://api.tavily.com/search'
    const searchUrl = new URL(tavilyUrl)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this.fetchImpl(searchUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'Mozilla/5.0 (compatible; AgentPlatform/1.0)',
        },
        body: JSON.stringify({
          query,
          max_results: limit,
        }),
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Tavily returned HTTP ${response.status}`)
      }

      const payload = await response.json()
      const result = normalizeTavilyResponse(payload, baseUrl)
      result.results = result.results.slice(0, limit)
      result.total = result.results.length

      return result
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async fetchWithLegacyRemote(
    endpointUrl: string,
    apiKey: string | undefined,
    query: string,
    limit: number,
  ): Promise<WebSearchResult> {
    const searchUrl = new URL(endpointUrl)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('limit', String(limit))

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; AgentPlatform/1.0)',
      }
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`
      }

      const response = await this.fetchImpl(searchUrl, {
        method: 'GET',
        signal: controller.signal,
        headers,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Remote search returned HTTP ${response.status}`)
      }

      const payload = await response.json()
      const results = this.normalizeRemoteResponse(payload, endpointUrl)
      results.results = results.results.slice(0, limit)
      results.total = results.results.length

      return results
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private normalizeRemoteResponse(payload: unknown, endpointUrl: string): WebSearchResult {
    const record =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}

    const query = typeof record.query === 'string' ? record.query : ''
    const resultsArray = Array.isArray(record.results) ? record.results : []

    const results = resultsArray
      .map((item: unknown) => {
        const r =
          item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}
        const title = typeof r.title === 'string' ? r.title.trim() : undefined
        const url = typeof r.url === 'string' ? r.url.trim() : undefined
        const snippet =
          typeof r.snippet === 'string' ? r.snippet.trim() : typeof r.content === 'string' ? r.content.trim() : ''

        if (!title || !url) return undefined

        return { title, url, snippet }
      })
      .filter((item): item is { title: string; url: string; snippet: string } => item !== undefined)

    const host = (() => {
      try {
        return new URL(endpointUrl).host
      } catch {
        return endpointUrl
      }
    })()

    return {
      query,
      results,
      total: results.length,
      provider: 'remote',
      endpointHost: host,
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'search.web_search',
        name: 'Web Search',
        description: 'Search the web for information using configured backend',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          query: { type: 'string', required: true, description: 'Search query' },
          limit: { type: 'number', description: 'Maximum results to return (default: 5, max: 10)' },
        },
        requiresAuth: false,
        supportedOperations: ['web_search', 'search'],
      },
      {
        capabilityId: 'search.news_search',
        name: 'News Search',
        description: 'Search news articles',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          query: { type: 'string', required: true, description: 'Search query' },
          limit: { type: 'number', description: 'Maximum results to return' },
        },
        requiresAuth: false,
        supportedOperations: ['news_search', 'search'],
      },
    ]
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    const backend = this.getBackendFromEnv()
    if (backend === 'none') {
      return { healthy: false, message: 'No search backend configured' }
    }
    return { healthy: true, message: `Search connector is healthy (backend: ${backend})` }
  }
}

export function createRealSearchConnectorAdapter(config?: RealSearchConnectorConfig): RealSearchConnectorAdapter {
  return new RealSearchConnectorAdapter(config)
}
