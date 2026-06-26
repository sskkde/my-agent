import type { SearchIntent, SearchQueryPlan } from './search-subagent-types.js'
import type { SearchQueryPlanner, SearchSubagentToolInput } from './search-subagent-tool.js'

const RECENCY_TERMS = ['latest', 'recent', 'today', 'current', 'new'] as const
const LOCATION_PREPOSITIONS = [' in ', ' near ', ' at ', ' for '] as const
const LOCATION_WORDS = ['tokyo', 'london', 'paris', 'new york', 'berlin', 'sydney', 'singapore'] as const

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function includesWord(value: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value)
}

function appendMissingTerms(query: string, terms: readonly string[]): string {
  const missingTerms = terms.filter((term) => !includesWord(query, term))
  return normalizeQuery([query, ...missingTerms].join(' '))
}

function hasLocationSignal(question: string, locale?: string): boolean {
  const normalizedQuestion = ` ${question.toLowerCase()} `
  return (
    Boolean(locale?.trim()) ||
    LOCATION_PREPOSITIONS.some((preposition) => normalizedQuestion.includes(preposition)) ||
    LOCATION_WORDS.some((word) => normalizedQuestion.includes(word))
  )
}

function missingLocationContext(question: string, locale?: string): string[] {
  return hasLocationSignal(question, locale) ? [] : ['location']
}

function plannedFreshness(intent: SearchIntent, freshnessRequired?: boolean): boolean {
  return freshnessRequired ?? (intent === 'news' || intent === 'weather' || intent === 'local')
}

function planSearchQuery(input: SearchSubagentToolInput, intent: SearchIntent): string {
  const question = normalizeQuery(input.originalQuestion)
  const localeTerm = input.locale ? ` ${input.locale}` : ''

  switch (intent) {
    case 'weather':
      return appendMissingTerms(`${question}${localeTerm}`, ['weather', 'today'])
    case 'news':
      return appendMissingTerms(question, ['latest', 'news'])
    case 'technical':
      return appendMissingTerms(question, includesWord(question, 'documentation') ? ['official'] : ['official', 'documentation'])
    case 'product':
      return appendMissingTerms(question, ['review', 'comparison', 'specs', 'price'])
    case 'local':
      return appendMissingTerms(`${question}${localeTerm}`, RECENCY_TERMS)
    case 'general':
      return question
  }
}

export class DefaultSearchQueryPlanner implements SearchQueryPlanner {
  plan(input: SearchSubagentToolInput): SearchQueryPlan {
    const intent = input.intent ?? 'general'
    const missingCriticalContext = intent === 'weather' || intent === 'local' ? missingLocationContext(input.originalQuestion, input.locale) : []

    return {
      originalQuestion: input.originalQuestion,
      searchQuery: planSearchQuery(input, intent),
      intent,
      requiresFreshness: plannedFreshness(intent, input.freshnessRequired),
      locale: input.locale,
      missingCriticalContext,
    }
  }
}
