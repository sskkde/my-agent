import type { ConnectorAdapter, ConnectorCapability, ConnectorCallRequest, ConnectorResponse } from '../types.js'
import type { ConnectorInstance } from '../../storage/connector-store.js'

export interface WebConnectorConfig {
  authState?: 'authenticated' | 'unauthenticated' | 'expired'
  rateLimitMode?: 'none' | 'limited' | 'exhausted'
  errorMode?: 'none' | 'transient' | 'permanent'
}

const mockWebPages = [
  {
    url: 'https://example.com/page1',
    title: 'Example Page 1',
    content: 'This is the content of example page 1. It contains some useful information.',
    fetchedAt: '2024-01-15T10:00:00Z',
  },
  {
    url: 'https://example.com/page2',
    title: 'Example Page 2',
    content: 'Another example page with different content for testing purposes.',
    fetchedAt: '2024-01-15T11:00:00Z',
  },
]

export interface WebFetchParams {
  url: string
}

export interface WebSearchParams {
  query: string
  limit?: number
}

export class WebConnectorAdapter implements ConnectorAdapter {
  private authState: 'authenticated' | 'unauthenticated' | 'expired'
  private rateLimitMode: 'none' | 'limited' | 'exhausted'
  private errorMode: 'none' | 'transient' | 'permanent'
  private callCount: number = 0

  constructor(config: WebConnectorConfig = {}) {
    this.authState = config.authState ?? 'authenticated'
    this.rateLimitMode = config.rateLimitMode ?? 'none'
    this.errorMode = config.errorMode ?? 'none'
  }

  setAuthState(state: 'authenticated' | 'unauthenticated' | 'expired'): void {
    this.authState = state
  }

  setRateLimitMode(mode: 'none' | 'limited' | 'exhausted'): void {
    this.rateLimitMode = mode
  }

  setErrorMode(mode: 'none' | 'transient' | 'permanent'): void {
    this.errorMode = mode
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    this.callCount++
    const preconditionError = this.checkPreconditions(request)
    if (preconditionError) {
      return preconditionError
    }

    const { operation, params } = request

    switch (operation) {
      case 'web_fetch':
        return this.webFetch(params as unknown as WebFetchParams)
      case 'web_search':
        return this.webSearch(params as unknown as WebSearchParams)
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  private checkPreconditions(request: ConnectorCallRequest): ConnectorResponse | null {
    if (this.authState === 'unauthenticated') {
      return {
        status: 'auth_required',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
          recoverable: true,
        },
      }
    }

    if (this.authState === 'expired') {
      return {
        status: 'auth_required',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: 'AUTH_EXPIRED',
          message: 'Authentication expired',
          recoverable: true,
        },
      }
    }

    if (this.rateLimitMode === 'exhausted') {
      return {
        status: 'rate_limited',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          recoverable: true,
        },
        metadata: {
          retryAfterMs: 30000,
        },
      }
    }

    if (this.errorMode === 'permanent') {
      return {
        status: 'failed',
        requestId: request.requestId,
        connectorInstanceId: request.connectorInstanceId,
        error: {
          code: 'PERMANENT_ERROR',
          message: 'Permanent failure',
          recoverable: false,
        },
      }
    }

    return null
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'web.web_fetch',
        name: 'Web Fetch',
        description: 'Fetch content from a URL',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {
          url: { type: 'string', required: true, description: 'URL to fetch' },
        },
        requiresAuth: false,
        supportedOperations: ['web_fetch'],
      },
      {
        capabilityId: 'web.web_search',
        name: 'Web Search',
        description: 'Search the web for information',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          query: { type: 'string', required: true, description: 'Search query' },
          limit: { type: 'number', description: 'Maximum results to return' },
        },
        requiresAuth: false,
        supportedOperations: ['web_search'],
      },
    ]
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    if (this.errorMode === 'permanent') {
      return { healthy: false, message: 'Permanent error mode' }
    }
    return { healthy: true, message: 'Web mock connector is healthy' }
  }

  private webFetch(params: WebFetchParams): { url: string; title: string; content: string; fetchedAt: string } {
    const { url } = params
    const mockPage = mockWebPages.find((p) => p.url === url)

    if (mockPage) {
      return mockPage
    }

    return {
      url,
      title: `Fetched Page: ${url}`,
      content: `This is mock content fetched from ${url}. In a real implementation, this would be the actual page content.`,
      fetchedAt: new Date().toISOString(),
    }
  }

  private webSearch(params: WebSearchParams): {
    results: Array<{ url: string; title: string; snippet: string }>
    query: string
    totalResults: number
  } {
    const { query, limit = 10 } = params
    const results = [
      {
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        title: `Search result for: ${query}`,
        snippet: `This is a mock search result for the query "${query}". It contains relevant information about the search term.`,
      },
      {
        url: `https://example.org/results?query=${encodeURIComponent(query)}`,
        title: `${query} - Example Results`,
        snippet: `Another mock result discussing ${query} and related topics.`,
      },
    ]

    return {
      results: results.slice(0, limit),
      query,
      totalResults: results.length,
    }
  }
}

export function createWebConnectorAdapter(config?: WebConnectorConfig): WebConnectorAdapter {
  return new WebConnectorAdapter(config)
}
