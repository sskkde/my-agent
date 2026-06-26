import type { ExtractedFact, SearchQueryPlan, SearchWarning } from './search-subagent-types.js'
import type { WebSearchResultItem } from './types.js'
import { scoreSourceQuality } from './source-quality.js'

const MAX_RESULTS = 10
const MAX_RESULTS_PER_DOMAIN = 3
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'for',
  'from',
  'how',
  'in',
  'is',
  'latest',
  'of',
  'on',
  'or',
  'the',
  'to',
  'today',
  'what',
  'when',
  'where',
  'with',
] as const)

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return url.toLowerCase().trim()
  }
}

function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
    ),
  )
}

function countKeywordMatches(text: string, keywords: readonly string[]): number {
  const normalizedText = text.toLowerCase()
  return keywords.filter((keyword) => normalizedText.includes(keyword)).length
}

function hasTimeSignal(result: WebSearchResultItem): boolean {
  const text = `${result.title} ${result.snippet} ${result.source ?? ''}`
  return (
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(text) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(text) ||
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(text) ||
    /\b(?:published|updated|posted|last updated|date|today|yesterday|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b/i.test(
      text,
    )
  )
}

export function scoreSearchResult(result: WebSearchResultItem, plan: SearchQueryPlan): number {
  const keywords = tokenizeQuery(plan.searchQuery || plan.originalQuestion)
  const titleMatches = countKeywordMatches(result.title, keywords)
  const snippetMatches = countKeywordMatches(result.snippet, keywords)
  let score = titleMatches * 12 + snippetMatches * 5 + Math.min(keywords.length, titleMatches + snippetMatches) * 2

  if (hasTimeSignal(result)) {
    score += plan.requiresFreshness ? 18 : 4
  } else if (plan.requiresFreshness) {
    score -= 8
  }

  if (extractDomain(result.url)) {
    score += 1
  }

  return score + scoreSourceQuality(result, plan)
}

function scoreRankedSearchResult(result: WebSearchResultItem, plan: SearchQueryPlan, providerRank: number): number {
  return scoreSearchResult(result, plan) + Math.max(0, 10 - providerRank)
}

export function rankSearchResults(results: readonly WebSearchResultItem[], plan: SearchQueryPlan): WebSearchResultItem[] {
  return results
    .map((result, index) => ({ result, index, score: scoreRankedSearchResult(result, plan, index + 1) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ result }) => result)
}

function limitResultsPerDomain(
  results: readonly WebSearchResultItem[],
  maxPerDomain = MAX_RESULTS_PER_DOMAIN,
): WebSearchResultItem[] {
  const domainCounts = new Map<string, number>()
  const limited: WebSearchResultItem[] = []

  for (const result of results) {
    const domain = extractDomain(result.url)
    const count = domainCounts.get(domain) ?? 0
    if (count >= maxPerDomain) {
      continue
    }
    domainCounts.set(domain, count + 1)
    limited.push(result)
  }

  return limited
}

export function selectSearchResults(results: readonly WebSearchResultItem[]): WebSearchResultItem[] {
  const domainLimited = limitResultsPerDomain(results)
  if (domainLimited.length >= MAX_RESULTS || results.length <= MAX_RESULTS) {
    return domainLimited.slice(0, MAX_RESULTS)
  }

  const selectedUrls = new Set(domainLimited.map((result) => result.url.toLowerCase().trim()))
  const selected = [...domainLimited]

  for (const result of results) {
    const normalizedUrl = result.url.toLowerCase().trim()
    if (selectedUrls.has(normalizedUrl)) {
      continue
    }
    selected.push(result)
    selectedUrls.add(normalizedUrl)
    if (selected.length >= MAX_RESULTS) {
      break
    }
  }

  return selected
}

export function deduplicateResults(results: readonly WebSearchResultItem[]): WebSearchResultItem[] {
  const seen = new Set<string>()
  const deduplicated: WebSearchResultItem[] = []

  for (const result of results) {
    const normalizedUrl = result.url.toLowerCase().trim()
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl)
      deduplicated.push(result)
    }
  }

  return deduplicated
}

export function cleanSnippets(results: readonly WebSearchResultItem[]): WebSearchResultItem[] {
  return results.map((result) => ({
    ...result,
    snippet: result.snippet
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  }))
}

export function extractFacts(results: readonly WebSearchResultItem[]): ExtractedFact[] {
  const facts: ExtractedFact[] = []
  for (const result of results) {
    const sentences = result.snippet
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 10)

    for (const sentence of sentences) {
      facts.push({ fact: sentence, sourceUrl: result.url, confidence: 0.7, relevanceScore: undefined })
    }
  }
  return facts
}

export function checkFreshnessWarning(plan: SearchQueryPlan, results: readonly WebSearchResultItem[]): SearchWarning[] {
  if (!plan.requiresFreshness) {
    return []
  }

  const hasTimestampInfo = results.some((result) => result.source?.includes('date') || result.snippet.match(/\d{4}-\d{2}-\d{2}/))
  if (hasTimestampInfo || results.length === 0) {
    return []
  }

  return [
    {
      code: 'FRESHNESS_UNVERIFIABLE',
      message: 'Query requires fresh results but no publication dates were found in the results. Information may be outdated.',
      recoverable: true,
    },
  ]
}

export function countUniqueSources(results: readonly WebSearchResultItem[]): number {
  const domains = new Set<string>()
  for (const result of results) {
    domains.add(extractDomain(result.url))
  }
  return domains.size
}
