import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
  ConnectorResponse,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';

export interface SearchConnectorConfig {
  authState?: 'authenticated' | 'unauthenticated' | 'expired';
  rateLimitMode?: 'none' | 'limited' | 'exhausted';
  errorMode?: 'none' | 'transient' | 'permanent';
}

const mockSearchResults = [
  {
    id: 'result-001',
    title: 'Introduction to TypeScript',
    url: 'https://example.com/typescript-intro',
    snippet: 'Learn the basics of TypeScript and how to get started with type-safe JavaScript development.',
    source: 'web',
    relevanceScore: 0.95,
  },
  {
    id: 'result-002',
    title: 'Advanced TypeScript Patterns',
    url: 'https://example.com/typescript-patterns',
    snippet: 'Explore advanced patterns and best practices for TypeScript applications.',
    source: 'web',
    relevanceScore: 0.88,
  },
  {
    id: 'result-003',
    title: 'TypeScript vs JavaScript',
    url: 'https://example.com/typescript-vs-javascript',
    snippet: 'A comprehensive comparison between TypeScript and JavaScript.',
    source: 'web',
    relevanceScore: 0.82,
  },
];

export interface SearchParams {
  query: string;
  limit?: number;
  source?: 'web' | 'news' | 'all';
}

export class SearchConnectorAdapter implements ConnectorAdapter {
  private authState: 'authenticated' | 'unauthenticated' | 'expired';
  private rateLimitMode: 'none' | 'limited' | 'exhausted';
  private errorMode: 'none' | 'transient' | 'permanent';
  private callCount: number = 0;

  constructor(config: SearchConnectorConfig = {}) {
    this.authState = config.authState ?? 'authenticated';
    this.rateLimitMode = config.rateLimitMode ?? 'none';
    this.errorMode = config.errorMode ?? 'none';
  }

  setAuthState(state: 'authenticated' | 'unauthenticated' | 'expired'): void {
    this.authState = state;
  }

  setRateLimitMode(mode: 'none' | 'limited' | 'exhausted'): void {
    this.rateLimitMode = mode;
  }

  setErrorMode(mode: 'none' | 'transient' | 'permanent'): void {
    this.errorMode = mode;
  }

  async execute(
    _instance: ConnectorInstance,
    request: ConnectorCallRequest
  ): Promise<unknown> {
    this.callCount++;
    const preconditionError = this.checkPreconditions(request);
    if (preconditionError) {
      return preconditionError;
    }

    const { operation, params } = request;

    switch (operation) {
      case 'search':
      case 'web_search':
      case 'news_search':
        return this.search(params as unknown as SearchParams);
      default:
        throw new Error(`Unknown operation: ${operation}`);
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
      };
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
      };
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
      };
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
      };
    }

    return null;
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'search.web_search',
        name: 'Web Search',
        description: 'Search the web for information',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          query: { type: 'string', required: true, description: 'Search query' },
          limit: { type: 'number', description: 'Maximum results to return' },
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
    ];
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    if (this.errorMode === 'permanent') {
      return { healthy: false, message: 'Permanent error mode' };
    }
    return { healthy: true, message: 'Search mock connector is healthy' };
  }

  private search(params: SearchParams): {
    results: typeof mockSearchResults;
    query: string;
    totalResults: number;
  } {
    const { query, limit = 10 } = params;
    const lowerQuery = query.toLowerCase();
    
    const filteredResults = mockSearchResults.filter(
      r =>
        r.title.toLowerCase().includes(lowerQuery) ||
        r.snippet.toLowerCase().includes(lowerQuery)
    );

    return {
      results: filteredResults.slice(0, limit),
      query,
      totalResults: filteredResults.length,
    };
  }
}

export function createSearchConnectorAdapter(config?: SearchConnectorConfig): SearchConnectorAdapter {
  return new SearchConnectorAdapter(config);
}
