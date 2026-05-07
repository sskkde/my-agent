import type { ToolDefinition, ToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { validateTimeout } from './web-safety.js';

export interface WebSearchParams {
  query: string;
  limit?: number;
  timeoutMs?: number;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchResultItem[];
  total: number;
  provider: string;
  endpointHost: string;
}

export interface WebSearchToolConfig {
  endpointUrl?: string;
  apiKey?: string;
  provider?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
}

function getStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function extractResultArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const directCandidates = [record.results, record.items, record.organic, record.webPages];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const web = asRecord(record.web);
  if (web && Array.isArray(web.results)) {
    return web.results;
  }

  const webPages = asRecord(record.webPages);
  if (webPages && Array.isArray(webPages.value)) {
    return webPages.value;
  }

  return [];
}

function normalizeSearchItem(item: unknown): WebSearchResultItem | undefined {
  const record = asRecord(item);
  if (!record) {
    return undefined;
  }

  const title = getStringField(record, ['title', 'name']);
  const url = getStringField(record, ['url', 'link', 'href']);
  const snippet = getStringField(record, ['snippet', 'description', 'content', 'summary']) ?? '';

  if (!title || !url) {
    return undefined;
  }

  const source = getStringField(record, ['source', 'displayLink', 'siteName']);
  return source ? { title, url, snippet, source } : { title, url, snippet };
}

function buildSearchUrl(endpointUrl: string, query: string, limit: number): URL {
  const encodedQuery = encodeURIComponent(query);
  const resolvedEndpoint = endpointUrl.includes('{query}')
    ? endpointUrl.replaceAll('{query}', encodedQuery)
    : endpointUrl;
  const url = new URL(resolvedEndpoint);

  if (!endpointUrl.includes('{query}') && !url.searchParams.has('q') && !url.searchParams.has('query')) {
    url.searchParams.set('q', query);
  }
  if (!url.searchParams.has('limit') && !url.searchParams.has('count')) {
    url.searchParams.set('limit', String(limit));
  }

  return url;
}

export function createWebSearchTool(config: WebSearchToolConfig = {}): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as WebSearchParams;
    const query = typeof typedParams.query === 'string' ? typedParams.query.trim() : '';

    if (!query) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: query',
          recoverable: true,
        },
      };
    }

    const endpointUrl = config.endpointUrl ?? process.env.WEB_SEARCH_API_URL;
    if (!endpointUrl) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'WEB_SEARCH_API_URL is not configured',
          recoverable: true,
        },
      };
    }

    const limit = normalizeLimit(typedParams.limit);
    const timeoutMs = validateTimeout(typedParams.timeoutMs);
    let searchUrl: URL;
    try {
      searchUrl = buildSearchUrl(endpointUrl, query, limit);
    } catch {
      return {
        success: false,
        error: {
          code: 'INVALID_ENDPOINT',
          message: 'WEB_SEARCH_API_URL must be a valid URL',
          recoverable: true,
        },
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchImpl = config.fetchImpl ?? globalThis.fetch;
      const apiKey = config.apiKey ?? process.env.WEB_SEARCH_API_KEY;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; WebSearchTool/1.0)',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetchImpl(searchUrl, {
        method: 'GET',
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: `Search provider returned HTTP ${response.status}`,
            recoverable: true,
          },
        };
      }

      const payload = await response.json() as unknown;
      const results = extractResultArray(payload)
        .map(normalizeSearchItem)
        .filter((item): item is WebSearchResultItem => item !== undefined)
        .slice(0, limit);

      const result: WebSearchResult = {
        query,
        results,
        total: results.length,
        provider: config.provider ?? 'custom',
        endpointHost: searchUrl.hostname,
      };

      return {
        success: true,
        data: result,
        resultPreview: `Found ${results.length} web results for "${query}"`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          code: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'SEARCH_FAILED',
          message: error instanceof Error && error.name === 'AbortError'
            ? `Search request timed out after ${timeoutMs}ms`
            : errorMessage,
          recoverable: true,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return {
    name: 'web.search',
    description: 'Search the public web for information using an external search provider',
    category: 'search',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 5, max: 10)' },
        timeoutMs: { type: 'number', description: 'Request timeout in milliseconds (default: 10000, max: 30000)' },
      },
      required: ['query'],
    },
    handler,
  };
}
