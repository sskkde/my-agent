import type { SearchQueryPlan } from './search-subagent-types.js'
import type { WebSearchResultItem } from './types.js'

export const SOURCE_QUALITY_SCORING_VERSION = 'source-quality-v1' as const

const OFFICIAL_DOCUMENTATION_DOMAINS = ['react.dev', 'developer.mozilla.org', 'docs.github.com', 'nodejs.org'] as const
const ACADEMIC_SUFFIXES = ['.edu', '.ac.uk'] as const
const NEWS_DOMAINS = ['reuters.com', 'apnews.com', 'bbc.com', 'nytimes.com', 'wsj.com'] as const
const FORUM_DOMAINS = ['stackoverflow.com', 'reddit.com', 'quora.com'] as const
const BLOG_TERMS = ['blog', 'medium.com', 'dev.to', 'substack.com'] as const

function parseHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function hasDateSignal(value: string): boolean {
  return (
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(value) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(value) ||
    /\b(?:published|updated|posted|last updated|today|yesterday)\b/i.test(value)
  )
}

function hasConcreteSignal(value: string): boolean {
  return /\b(?:\d+(?:\.\d+)?|v\d+|\d{4})\b/i.test(value)
}

function scoreDomainAuthority(host: string | undefined, plan: SearchQueryPlan): number {
  if (!host) {
    return -8
  }

  if (OFFICIAL_DOCUMENTATION_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return 28
  }

  if (host === 'github.com') {
    return plan.intent === 'technical' ? 22 : 10
  }

  if (ACADEMIC_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return 18
  }

  if (NEWS_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return plan.intent === 'news' ? 18 : 8
  }

  if (FORUM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return plan.intent === 'technical' ? 4 : -2
  }

  if (BLOG_TERMS.some((term) => host.includes(term))) {
    return -4
  }

  return 0
}

export function scoreSourceQuality(result: WebSearchResultItem, plan: SearchQueryPlan): number {
  const host = parseHost(result.url)
  const text = `${result.title} ${result.snippet} ${result.source ?? ''}`
  let score = scoreDomainAuthority(host, plan)

  if (result.title.trim().length > 0) {
    score += 2
  }

  if (result.snippet.trim().length > 30) {
    score += 3
  }

  if (hasConcreteSignal(text)) {
    score += 4
  }

  if (hasDateSignal(text)) {
    score += plan.requiresFreshness ? 12 : 3
  } else if (plan.requiresFreshness) {
    score -= 6
  }

  return score
}
