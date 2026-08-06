/**
 * Multi-round-only canonical URL merging and bounded synthesis evidence.
 *
 * Pure functions only: no I/O, no module state. The multi-round search
 * controller uses these helpers to deduplicate results across rounds via a
 * canonical URL key (preserving the first-occurrence source) and to prepare a
 * bounded, ranked, diversified synthesis input for the single final phase-2
 * call. Single-round callers keep using the shared `deduplicateResults()`
 * pipeline unchanged.
 */

import type { SearchQueryPlan } from './search-subagent-types.js'
import type { WebSearchResultItem } from './types.js'
import { cleanSnippets, rankSearchResults, selectSearchResults } from './search-result-processing.js'

const TRACKING_PARAM_NAMES: ReadonlySet<string> = new Set(['gclid', 'fbclid'])

function isTrackingParam(name: string): boolean {
  return name.startsWith('utm_') || TRACKING_PARAM_NAMES.has(name)
}

function compareParams(a: readonly [string, string], b: readonly [string, string]): number {
  if (a[0] < b[0]) return -1
  if (a[0] > b[0]) return 1
  if (a[1] < b[1]) return -1
  if (a[1] > b[1]) return 1
  return 0
}

/**
 * Compute a deterministic canonical key for a URL. Two URLs that differ only in
 * scheme/host case, `www.` prefix, default ports, fragment, or known tracking
 * parameters collapse to the same key; business query parameter values and
 * path case are preserved. Malformed URLs return `invalid:<url>` and never
 * throw, so callers can use the key directly as a dedup set entry.
 */
export function canonicalUrlKey(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `invalid:${url}`
  }

  const scheme = parsed.protocol.toLowerCase()
  let hostname = parsed.hostname.toLowerCase()
  if (hostname.startsWith('www.')) {
    hostname = hostname.slice(4)
  }

  let port = ''
  if (parsed.port.length > 0) {
    const isDefaultHttpPort = scheme === 'http:' && parsed.port === '80'
    const isDefaultHttpsPort = scheme === 'https:' && parsed.port === '443'
    if (!isDefaultHttpPort && !isDefaultHttpsPort) {
      port = `:${parsed.port}`
    }
  }

  const keptParams: Array<[string, string]> = []
  for (const [name, value] of parsed.searchParams) {
    if (isTrackingParam(name)) {
      continue
    }
    keptParams.push([name, value])
  }
  keptParams.sort(compareParams)

  let key = `${scheme}//${hostname}${port}${parsed.pathname}`
  if (keptParams.length > 0) {
    const query = keptParams
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join('&')
    key += `?${query}`
  }

  return key
}

/**
 * Merge accumulated multi-round results by canonical URL key. The first
 * occurrence wins (so existing items are retained in preference to incoming
 * duplicates), existing order is preserved, and new incoming items are
 * appended in their original order. Inputs are never mutated; a fresh array is
 * always returned.
 */
export function mergeRoundResults(
  existing: readonly WebSearchResultItem[],
  incoming: readonly WebSearchResultItem[],
): WebSearchResultItem[] {
  const seen = new Set<string>()
  const merged: WebSearchResultItem[] = []

  for (const item of existing) {
    const key = canonicalUrlKey(item.url)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(item)
    }
  }
  for (const item of incoming) {
    const key = canonicalUrlKey(item.url)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(item)
    }
  }

  return merged
}

/**
 * Prepare the bounded synthesis evidence for the final phase-2 call by chaining
 * the shared clean -> rank -> select pipeline. The existing MAX_RESULTS=10 cap
 * and per-domain diversity are enforced inside `selectSearchResults`; this
 * helper adds no further limits. Inputs are never mutated because
 * `cleanSnippets` returns fresh element objects.
 */
export function prepareSynthesisResults(
  results: readonly WebSearchResultItem[],
  plan: SearchQueryPlan,
): WebSearchResultItem[] {
  return selectSearchResults(rankSearchResults(cleanSnippets(results), plan))
}
