import type { WebSearchResult, WebSearchResultItem } from '../types.js'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function getStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

function extractResultArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  const record = asRecord(payload)
  if (!record) {
    return []
  }

  const directCandidates = [record.results, record.items, record.organic, record.webPages]
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  const web = asRecord(record.web)
  if (web && Array.isArray(web.results)) {
    return web.results
  }

  const webPages = asRecord(record.webPages)
  if (webPages && Array.isArray(webPages.value)) {
    return webPages.value
  }

  return []
}

function normalizeSearchItem(item: unknown): WebSearchResultItem | undefined {
  const record = asRecord(item)
  if (!record) {
    return undefined
  }

  const title = getStringField(record, ['title', 'name'])
  const url = getStringField(record, ['url', 'link', 'href'])
  const snippet = getStringField(record, ['snippet', 'description', 'content', 'summary']) ?? ''

  if (!title || !url) {
    return undefined
  }

  const source = getStringField(record, ['source', 'displayLink', 'siteName'])
  return source ? { title, url, snippet, source } : { title, url, snippet }
}

export function normalizeLegacyRemoteResponse(
  payload: unknown,
  endpointUrl: string,
  provider?: string,
): WebSearchResult {
  const record = asRecord(payload)
  const query = record && typeof record.query === 'string' ? record.query : ''

  const results: WebSearchResultItem[] = extractResultArray(payload)
    .map(normalizeSearchItem)
    .filter((item): item is WebSearchResultItem => item !== undefined)

  return {
    query,
    results,
    total: results.length,
    provider: provider ?? 'custom',
    endpointHost: extractHost(endpointUrl),
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
