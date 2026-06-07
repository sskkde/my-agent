import type { WebSearchResult, WebSearchResultItem } from '../types.js'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function normalizeTavilyItem(item: unknown): WebSearchResultItem | undefined {
  const record = asRecord(item)
  if (!record) {
    return undefined
  }

  const title = typeof record.title === 'string' ? record.title.trim() : undefined
  const url = typeof record.url === 'string' ? record.url.trim() : undefined
  const content = typeof record.content === 'string' ? record.content.trim() : undefined

  if (!title || !url) {
    return undefined
  }

  return {
    title,
    url,
    snippet: content ?? '',
  }
}

export function normalizeTavilyResponse(payload: unknown, baseUrl?: string): WebSearchResult {
  const record = asRecord(payload)
  if (!record) {
    return {
      query: '',
      results: [],
      total: 0,
      provider: 'tavily',
      endpointHost: extractHost(baseUrl ?? 'https://api.tavily.com'),
    }
  }

  const query = typeof record.query === 'string' ? record.query : ''
  const resultsArray = Array.isArray(record.results) ? record.results : []

  const results: WebSearchResultItem[] = resultsArray
    .map(normalizeTavilyItem)
    .filter((item): item is WebSearchResultItem => item !== undefined)

  return {
    query,
    results,
    total: results.length,
    provider: 'tavily',
    endpointHost: extractHost(baseUrl ?? 'https://api.tavily.com'),
  }
}

function extractHost(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host
  } catch {
    return url
  }
}
