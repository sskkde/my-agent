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
      return appendMissingTerms(
        question,
        includesWord(question, 'documentation') ? ['official'] : ['official', 'documentation'],
      )
    case 'product':
      return appendMissingTerms(question, ['review', 'comparison', 'specs', 'price'])
    case 'local':
      return appendMissingTerms(`${question}${localeTerm}`, RECENCY_TERMS)
    case 'general':
      return question
    default:
      return question
  }
}

const KNOWN_INTENTS = new Set<SearchIntent>(['weather', 'news', 'technical', 'product', 'local', 'general'])

function normalizeIntent(intent: SearchSubagentToolInput['intent']): SearchIntent {
  if (intent && KNOWN_INTENTS.has(intent as SearchIntent)) {
    return intent as SearchIntent
  }
  // Models often emit free-form intents (e.g. "fact"); treat as general.
  return 'general'
}

export class DefaultSearchQueryPlanner implements SearchQueryPlanner {
  plan(input: SearchSubagentToolInput): SearchQueryPlan {
    const intent = normalizeIntent(input.intent)
    const originalQuestion = normalizeQuery(input.originalQuestion || '')
    const missingCriticalContext =
      intent === 'weather' || intent === 'local' ? missingLocationContext(originalQuestion, input.locale) : []

    const planned = planSearchQuery({ ...input, originalQuestion, intent }, intent)
    const searchQuery = normalizeQuery(planned || originalQuestion)

    return {
      originalQuestion,
      searchQuery: searchQuery.length > 0 ? searchQuery : originalQuestion,
      intent,
      requiresFreshness: plannedFreshness(intent, input.freshnessRequired),
      locale: input.locale,
      missingCriticalContext,
    }
  }
}
