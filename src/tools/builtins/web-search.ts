import type { ToolDefinition, ToolHandler, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import type { WebSearchResult, SearchBackend, SearchErrorCode } from '../../search/types.js';
import type { Browser } from 'playwright-core';
import { validateTimeout } from './web-safety.js';
import { resolveSearchBackend } from '../../search/backend-resolver.js';
import { normalizeSearXNGResponse } from '../../search/providers/searxng.js';
import { normalizeTavilyResponse } from '../../search/providers/tavily.js';
import { normalizeLegacyRemoteResponse } from '../../search/providers/legacy-remote.js';
import { searchWithDuckDuckGoBrowser } from '../../search/browser/duckduckgo-provider.js';

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

export interface WebSearchToolConfig {
  endpointUrl?: string;
  apiKey?: string;
  provider?: string;
  fetchImpl?: typeof fetch;
  browser?: Browser;
  browserProvider?: () => Promise<Browser | undefined>;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
}

function getBackendFromEnv(): SearchBackend {
  const backendEnv = process.env.WEB_SEARCH_BACKEND;
  if (backendEnv === 'searxng' || backendEnv === 'tavily' || backendEnv === 'remote' || backendEnv === 'playwright' || backendEnv === 'auto-browser' || backendEnv === 'none') {
    return backendEnv;
  }
  return 'auto';
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

function buildSearXNGSearchUrl(baseUrl: string, query: string, limit: number): URL {
  const searchUrl = buildSearchUrl(baseUrl, query, limit);

  if (searchUrl.pathname === '/' || searchUrl.pathname === '') {
    searchUrl.pathname = '/search';
  }

  searchUrl.searchParams.set('format', 'json');
  return searchUrl;
}

async function fetchWithSearXNG(
  baseUrl: string,
  query: string,
  limit: number,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ success: true; result: WebSearchResult } | { success: false; errorCode: SearchErrorCode; message: string }> {
  const searchUrl = buildSearXNGSearchUrl(baseUrl, query, limit);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetchImpl(searchUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; WebSearchTool/1.0)',
      },
    });
    
    if (!response.ok) {
      return {
        success: false,
        errorCode: 'PROVIDER_ERROR',
        message: `SearXNG returned HTTP ${response.status}`,
      };
    }
    
    const payload = await response.json() as unknown;
    const result = normalizeSearXNGResponse(payload, baseUrl);
    
    // Apply limit to results
    result.results = result.results.slice(0, limit);
    result.total = result.results.length;
    
    return { success: true, result };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        errorCode: 'TIMEOUT',
        message: `SearXNG request timed out after ${timeoutMs}ms`,
      };
    }
    return {
      success: false,
      errorCode: 'SEARCH_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithTavily(
  apiKey: string,
  query: string,
  limit: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  baseUrl?: string
): Promise<{ success: true; result: WebSearchResult } | { success: false; errorCode: SearchErrorCode; message: string }> {
  const tavilyUrl = baseUrl ?? 'https://api.tavily.com/search';
  const searchUrl = new URL(tavilyUrl);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetchImpl(searchUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0 (compatible; WebSearchTool/1.0)',
      },
      body: JSON.stringify({
        query,
        max_results: limit,
      }),
    });
    
    if (!response.ok) {
      return {
        success: false,
        errorCode: 'PROVIDER_ERROR',
        message: `Tavily returned HTTP ${response.status}`,
      };
    }
    
    const payload = await response.json() as unknown;
    const result = normalizeTavilyResponse(payload, baseUrl);
    
    // Apply limit to results
    result.results = result.results.slice(0, limit);
    result.total = result.results.length;
    
    return { success: true, result };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        errorCode: 'TIMEOUT',
        message: `Tavily request timed out after ${timeoutMs}ms`,
      };
    }
    return {
      success: false,
      errorCode: 'SEARCH_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithLegacyRemote(
  endpointUrl: string,
  apiKey: string | undefined,
  query: string,
  limit: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  provider?: string
): Promise<{ success: true; result: WebSearchResult } | { success: false; errorCode: SearchErrorCode; message: string }> {
  let searchUrl: URL;
  try {
    searchUrl = buildSearchUrl(endpointUrl, query, limit);
  } catch {
    return {
      success: false,
      errorCode: 'INVALID_ENDPOINT',
      message: 'WEB_SEARCH_API_URL must be a valid URL',
    };
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
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
        errorCode: 'PROVIDER_ERROR',
        message: `Remote search returned HTTP ${response.status}`,
      };
    }
    
    const payload = await response.json() as unknown;
    const result = normalizeLegacyRemoteResponse(payload, endpointUrl, provider);
    
    // Apply limit to results
    result.results = result.results.slice(0, limit);
    result.total = result.results.length;
    
    return { success: true, result };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        errorCode: 'TIMEOUT',
        message: `Remote request timed out after ${timeoutMs}ms`,
      };
    }
    return {
      success: false,
      errorCode: 'SEARCH_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithPlaywright(
  query: string,
  limit: number,
  timeoutMs: number,
  browser?: Browser,
  browserProvider?: () => Promise<Browser | undefined>
): Promise<{ success: true; result: WebSearchResult } | { success: false; errorCode: SearchErrorCode; message: string }> {
  let resolvedBrowser: Browser | undefined;
  try {
    resolvedBrowser = browser ?? await browserProvider?.();
  } catch (error) {
    return {
      success: false,
      errorCode: 'BROWSER_SEARCH_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'CloakBrowser browser not available',
    };
  }

  if (!resolvedBrowser) {
    return {
      success: false,
      errorCode: 'BROWSER_SEARCH_UNAVAILABLE',
      message: 'CloakBrowser browser not available',
    };
  }
  
  const browserResult = await searchWithDuckDuckGoBrowser({
    query,
    browser: resolvedBrowser,
    timeoutMs,
  });
  
  if (!browserResult.success) {
    return {
      success: false,
      errorCode: browserResult.errorCode ?? 'BROWSER_SEARCH_UNAVAILABLE',
      message: 'Browser search failed',
    };
  }
  
  // Apply limit to results
  const results = browserResult.results?.slice(0, limit) ?? [];
  
  return {
    success: true,
    result: {
      query,
      results,
      total: results.length,
      provider: browserResult.provider ?? 'duckduckgo-browser',
      endpointHost: browserResult.endpointHost ?? 'duckduckgo.com',
    },
  };
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

    const limit = normalizeLimit(typedParams.limit);
    const timeoutMs = validateTimeout(typedParams.timeoutMs);
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;

    // Resolve backend from environment and config
    const backend = getBackendFromEnv();
    const searxngBaseUrl = process.env.SEARXNG_BASE_URL;
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    const tavilyBaseUrl = process.env.TAVILY_BASE_URL;
    const remoteApiUrl = config.endpointUrl ?? process.env.WEB_SEARCH_API_URL;
    const remoteApiKey = config.apiKey ?? process.env.WEB_SEARCH_API_KEY;

    const backendResult = resolveSearchBackend({
      backend,
      searxngBaseUrl,
      tavilyApiKey,
      remoteApiUrl,
    });

    if (backendResult.selectedBackend === 'none') {
      return {
        success: false,
        error: {
          code: backendResult.errorCode ?? 'PROVIDER_NOT_CONFIGURED',
          message: 'No search provider configured',
          recoverable: true,
        },
      };
    }

    // Execute search based on selected backend
    let searchResult: { success: true; result: WebSearchResult } | { success: false; errorCode: SearchErrorCode; message: string };

    switch (backendResult.selectedBackend) {
      case 'searxng':
        if (!backendResult.baseUrl) {
          return {
            success: false,
            error: {
              code: 'PROVIDER_NOT_CONFIGURED',
              message: 'SEARXNG_BASE_URL is not configured',
              recoverable: true,
            },
          };
        }
        searchResult = await fetchWithSearXNG(backendResult.baseUrl, query, limit, timeoutMs, fetchImpl);
        break;

      case 'tavily':
        if (!tavilyApiKey) {
          return {
            success: false,
            error: {
              code: 'PROVIDER_NOT_CONFIGURED',
              message: 'TAVILY_API_KEY is not configured',
              recoverable: true,
            },
          };
        }
        searchResult = await fetchWithTavily(tavilyApiKey, query, limit, timeoutMs, fetchImpl, tavilyBaseUrl);
        break;

      case 'remote':
        if (!backendResult.baseUrl) {
          return {
            success: false,
            error: {
              code: 'PROVIDER_NOT_CONFIGURED',
              message: 'WEB_SEARCH_API_URL is not configured',
              recoverable: true,
            },
          };
        }
        searchResult = await fetchWithLegacyRemote(backendResult.baseUrl, remoteApiKey, query, limit, timeoutMs, fetchImpl, config.provider);
        break;

      case 'playwright':
        searchResult = await fetchWithPlaywright(query, limit, timeoutMs, config.browser, config.browserProvider);
        break;

      default:
        return {
          success: false,
          error: {
            code: 'PROVIDER_NOT_CONFIGURED',
            message: 'No search provider configured',
            recoverable: true,
          },
        };
    }

    if (!searchResult.success) {
      return {
        success: false,
        error: {
          code: searchResult.errorCode,
          message: searchResult.message,
          recoverable: true,
        },
      };
    }

    const result = searchResult.result;

    return {
      success: true,
      data: result,
      resultPreview: `Found ${result.results.length} web results for "${query}"`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };

  return {
    name: 'web_search',
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
