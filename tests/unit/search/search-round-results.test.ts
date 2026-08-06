import { describe, expect, it } from 'vitest'
import type { SearchQueryPlan } from '../../../src/search/search-subagent-types.js'
import type { WebSearchResultItem } from '../../../src/search/types.js'
import {
  canonicalUrlKey,
  mergeRoundResults,
  prepareSynthesisResults,
} from '../../../src/search/search-round-results.js'

const BASE_PLAN: SearchQueryPlan = {
  originalQuestion: 'What is X?',
  searchQuery: 'what is x',
  intent: 'general',
  requiresFreshness: false,
  missingCriticalContext: [],
}

function makeResult(url: string, title = `Title ${url}`, snippet = `snippet ${url}`): WebSearchResultItem {
  return { title, url, snippet }
}

function snapshot<T>(value: readonly T[]): readonly T[] {
  return value.map((item) => ({ ...item }))
}

describe('canonicalUrlKey', () => {
  it('produces the same key for a normalized URL and its tracking/www/port variant', () => {
    // Given: a canonical URL and a noisy variant that should be treated as identical
    const clean = 'https://example.com/a?id=1'
    const noisy = 'https://www.Example.com:443/a?id=1&utm_source=x#top'

    // When: canonical keys are computed
    const cleanKey = canonicalUrlKey(clean)
    const noisyKey = canonicalUrlKey(noisy)

    // Then: both reduce to the same canonical key, with the fragment and tracking param removed
    expect(cleanKey).toBe('https://example.com/a?id=1')
    expect(noisyKey).toBe(cleanKey)
  })

  it('produces distinct keys when business query parameters differ', () => {
    // Given: two URLs that differ only in a business query parameter value
    const a = 'https://example.com/a?id=1'
    const b = 'https://example.com/a?id=2'

    // When: canonical keys are computed
    const keyA = canonicalUrlKey(a)
    const keyB = canonicalUrlKey(b)

    // Then: the keys remain distinct - business params are preserved
    expect(keyA).not.toBe(keyB)
    expect(keyA).toBe('https://example.com/a?id=1')
    expect(keyB).toBe('https://example.com/a?id=2')
  })

  it('returns a deterministic invalid:<url> key for malformed URLs without throwing', () => {
    // Given: a string that is not a valid URL
    const malformed = 'not a url'

    // When: the canonical key is computed (it must not throw)
    const key = canonicalUrlKey(malformed)

    // Then: a deterministic invalid: prefix is returned
    expect(key).toBe('invalid:not a url')
  })

  it('strips utm_*, gclid and fbclid tracking parameters while preserving business params', () => {
    // Given: a URL carrying tracking and business parameters
    const url = 'https://example.com/p?utm_source=google&gclid=abc&fbclid=def&id=42&utm_medium=cpc'

    // When: the canonical key is computed
    const key = canonicalUrlKey(url)

    // Then: only the business `id` parameter remains, tracking params removed
    expect(key).toBe('https://example.com/p?id=42')
  })

  it('sorts remaining query parameters for a stable key regardless of input order', () => {
    // Given: two URLs with the same params in different order
    const a = 'https://example.com/p?b=2&a=1'
    const b = 'https://example.com/p?a=1&b=2'

    // When: canonical keys are computed
    const keyA = canonicalUrlKey(a)
    const keyB = canonicalUrlKey(b)

    // Then: both produce the same sorted-param key
    expect(keyA).toBe('https://example.com/p?a=1&b=2')
    expect(keyB).toBe(keyA)
  })

  it('preserves path case and business parameter values verbatim', () => {
    // Given: a URL with mixed-case path and a value containing special characters
    const url = 'https://example.com/MyPage/Detail?ref=Hello+World&q=a%20b'

    // When: the canonical key is computed
    const key = canonicalUrlKey(url)

    // Then: path case and decoded param values are preserved and re-encoded
    expect(key).toBe('https://example.com/MyPage/Detail?q=a%20b&ref=Hello%20World')
  })

  it('strips default ports for http:80 and https:443 but keeps non-default ports', () => {
    // Given: URLs with default and non-default ports
    const httpsDefault = 'https://example.com:443/p'
    const httpDefault = 'http://example.com:80/p'
    const httpsCustom = 'https://example.com:8443/p'

    // When: canonical keys are computed
    const keyHttpsDefault = canonicalUrlKey(httpsDefault)
    const keyHttpDefault = canonicalUrlKey(httpDefault)
    const keyHttpsCustom = canonicalUrlKey(httpsCustom)

    // Then: default ports are stripped, custom ports are kept
    expect(keyHttpsDefault).toBe('https://example.com/p')
    expect(keyHttpDefault).toBe('http://example.com/p')
    expect(keyHttpsCustom).toBe('https://example.com:8443/p')
  })

  it('strips www. prefix and lowercases scheme and hostname', () => {
    // Given: a URL with mixed-case host and www. prefix
    const url = 'HTTPS://WWW.Example.COM/p'

    // When: the canonical key is computed
    const key = canonicalUrlKey(url)

    // Then: scheme and host are lowercased and www. is removed
    expect(key).toBe('https://example.com/p')
  })
})

describe('mergeRoundResults', () => {
  it('preserves the first occurrence across existing and incoming lists (canonical key seen-set)', () => {
    // Given: an existing list with a tracking-heavy URL and an incoming list with its clean form
    const existing = [makeResult('https://example.com/a?id=1&utm_source=x', 'Existing title')]
    const incoming = [makeResult('https://example.com/a?id=1', 'Incoming title')]

    // When: rounds are merged
    const merged = mergeRoundResults(existing, incoming)

    // Then: the existing (first) item is preserved; the duplicate incoming item is dropped
    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe('Existing title')
  })

  it('retains existing order and appends new items in incoming order', () => {
    // Given: two distinct existing items and two distinct incoming items
    const existing = [makeResult('https://a.example.com/1'), makeResult('https://b.example.com/2')]
    const incoming = [makeResult('https://c.example.com/3'), makeResult('https://d.example.com/4')]

    // When: rounds are merged
    const merged = mergeRoundResults(existing, incoming)

    // Then: order is existing-first then incoming-in-order
    expect(merged.map((item) => item.url)).toEqual([
      'https://a.example.com/1',
      'https://b.example.com/2',
      'https://c.example.com/3',
      'https://d.example.com/4',
    ])
  })

  it('merges tracking-only variants to a single preserved first source', () => {
    // Given: the same canonical URL across two rounds with only tracking params differing
    const existing = [makeResult('https://example.com/x?utm_source=a', 'Round 1 source')]
    const incoming = [makeResult('https://example.com/x?fbclid=b', 'Round 2 source')]

    // When: rounds are merged
    const merged = mergeRoundResults(existing, incoming)

    // Then: only one source is retained and it is the first-occurrence (existing) source
    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe('Round 1 source')
  })

  it('keeps business-query variants distinct even when hosts and paths match', () => {
    // Given: two URLs differing only in a business query parameter value
    const existing = [makeResult('https://example.com/p?id=1')]
    const incoming = [makeResult('https://example.com/p?id=2')]

    // When: rounds are merged
    const merged = mergeRoundResults(existing, incoming)

    // Then: both items are retained because the canonical keys are distinct
    expect(merged).toHaveLength(2)
  })

  it('does not mutate the existing or incoming inputs', () => {
    // Given: two result lists captured before the merge
    const existing = [makeResult('https://example.com/a?id=1&utm_source=x')]
    const incoming = [makeResult('https://example.com/a?id=1')]
    const existingSnapshot = snapshot(existing)
    const incomingSnapshot = snapshot(incoming)

    // When: rounds are merged
    mergeRoundResults(existing, incoming)

    // Then: the input arrays and their element objects are unchanged
    expect(existing).toEqual(existingSnapshot)
    expect(incoming).toEqual(incomingSnapshot)
    expect(existing[0]?.url).toBe(existingSnapshot[0]?.url)
    expect(incoming[0]?.url).toBe(incomingSnapshot[0]?.url)
  })

  it('returns a new array even when both inputs are empty', () => {
    // Given: two empty result lists
    const existing: WebSearchResultItem[] = []
    const incoming: WebSearchResultItem[] = []

    // When: rounds are merged
    const merged = mergeRoundResults(existing, incoming)

    // Then: a fresh empty array is returned (not the same reference as either input)
    expect(merged).toEqual([])
    expect(merged).not.toBe(existing)
    expect(merged).not.toBe(incoming)
  })

  it('deduplicates within the existing list (first wins) and within the incoming list', () => {
    // Given: existing and incoming lists each containing canonical duplicates internally
    const existing = [
      makeResult('https://example.com/a?id=1', 'e1'),
      makeResult('https://example.com/a?id=1&utm_source=z', 'e2'),
    ]
    const incoming = [
      makeResult('https://example.com/b?id=1', 'i1'),
      makeResult('https://example.com/b?id=1&fbclid=q', 'i2'),
    ]

    // When: rounds are merged
    const merged = mergeRoundResults(existing, incoming)

    // Then: first-occurrence items are kept and duplicates are dropped
    expect(merged.map((item) => item.title)).toEqual(['e1', 'i1'])
  })
})

describe('prepareSynthesisResults', () => {
  it('caps synthesis evidence at MAX_RESULTS=10', () => {
    // Given: 12 distinct-domain results (so per-domain diversity does not trim them)
    const results: WebSearchResultItem[] = Array.from({ length: 12 }, (_, index) =>
      makeResult(`https://d${index}.example.com/p${index}`, `Title ${index}`, `snippet ${index}`),
    )

    // When: synthesis results are prepared
    const prepared = prepareSynthesisResults(results, BASE_PLAN)

    // Then: the output is capped at 10 results
    expect(prepared).toHaveLength(10)
  })

  it('enforces per-domain diversity by limiting to at most 3 results per domain', () => {
    // Given: 6 results all from the same domain
    const results: WebSearchResultItem[] = Array.from({ length: 6 }, (_, index) =>
      makeResult(`https://example.com/p${index}`, `Title ${index}`, `snippet ${index}`),
    )

    // When: synthesis results are prepared
    const prepared = prepareSynthesisResults(results, BASE_PLAN)

    // Then: at most 3 results from the same domain survive per-domain diversity
    const hostCounts = new Map<string, number>()
    for (const item of prepared) {
      const host = new URL(item.url).hostname
      hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1)
    }
    for (const count of hostCounts.values()) {
      expect(count).toBeLessThanOrEqual(3)
    }
    expect(prepared).toHaveLength(3)
  })

  it('does not mutate the input array or its element objects', () => {
    // Given: a result list captured before preparation
    const results: WebSearchResultItem[] = [
      makeResult('https://example.com/a?id=1', 'T1', 'raw <b>html</b> snippet'),
      makeResult('https://example.com/b?id=2', 'T2', 'clean snippet'),
    ]
    const snapshotResults = snapshot(results)

    // When: synthesis results are prepared
    prepareSynthesisResults(results, BASE_PLAN)

    // Then: the input array and elements are unchanged (cleanSnippets returns new objects)
    expect(results).toEqual(snapshotResults)
    expect(results[0]?.snippet).toBe('raw <b>html</b> snippet')
  })

  it('returns a fresh ranked and diversified list even for a single result', () => {
    // Given: a single matching result
    const results = [makeResult('https://example.com/match', 'Title', 'snippet match x')]

    // When: synthesis results are prepared
    const prepared = prepareSynthesisResults(results, BASE_PLAN)

    // Then: the single result is preserved (cleaned, ranked, selected)
    expect(prepared).toHaveLength(1)
    expect(prepared[0]?.url).toBe('https://example.com/match')
    expect(prepared[0]?.snippet).toBe('snippet match x')
  })
})
