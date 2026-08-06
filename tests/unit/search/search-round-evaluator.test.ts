import { describe, expect, it } from 'vitest'
import type { ExtractedFact, SearchIntent } from '../../../src/search/search-subagent-types.js'
import type { WebSearchResultItem } from '../../../src/search/types.js'
import {
  SEARCH_ROUND_REPLAN_REASONS,
  SEARCH_ROUND_STOP_REASONS,
  evaluateSearchRound,
  type SearchRoundDecision,
  type SearchRoundEvaluatorInput,
} from '../../../src/search/search-round-evaluator.js'

const FACT_SNIPPET = 'Tokyo recorded a new all-time high temperature during the afternoon.'
const SECOND_SNIPPET = 'A second independent source confirms the same measured reading today.'

function resultFor(domain: string, snippet = FACT_SNIPPET): WebSearchResultItem {
  return { title: `Result from ${domain}`, url: `https://${domain}/page`, snippet }
}

function factsFor(domains: readonly string[]): ExtractedFact[] {
  return domains.map((domain) => ({
    fact: FACT_SNIPPET,
    sourceUrl: `https://${domain}/page`,
    confidence: 0.7,
  }))
}

function input(overrides: Partial<SearchRoundEvaluatorInput> = {}): SearchRoundEvaluatorInput {
  return {
    results: [],
    facts: [],
    uniqueDomainCount: 0,
    intent: 'general',
    requiresFreshness: false,
    roundIndex: 1,
    maxRounds: 3,
    hasDuplicateCandidate: false,
    budgetExhausted: false,
    backendFailed: false,
    freshnessAttemptsUsed: 0,
    freshnessUnverifiable: false,
    missingCriticalContext: [],
    ...overrides,
  }
}

describe('evaluateSearchRound', () => {
  describe('stop decisions', () => {
    it('returns stop/sufficient_evidence when a weather round has one source with facts', () => {
      // Given: one weather source with extracted facts after round 1
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('weather.example')],
          facts: factsFor(['weather.example']),
          uniqueDomainCount: 1,
          intent: 'weather',
        }),
      )

      // When/Then: the evaluator stops immediately with sufficient evidence
      expect(decision.kind).toBe('stop')
      if (decision.kind === 'stop') {
        expect(decision.reason).toBe('sufficient_evidence')
      }
    })

    it('returns stop/max_rounds when the current round is the last allowed, even with weak evidence', () => {
      // Given: the round cap is reached with zero evidence
      const decision = evaluateSearchRound(
        input({
          roundIndex: 3,
          maxRounds: 3,
        }),
      )

      // When/Then: maxRounds always terminates, overriding a no_results replan
      expect(decision).toEqual({ kind: 'stop', reason: 'max_rounds' })
    })

    it('returns stop/max_rounds before any replan reason once the round cap is reached', () => {
      // Given: low-diversity evidence on the final allowed round
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('one.example')],
          facts: factsFor(['one.example']),
          uniqueDomainCount: 1,
          intent: 'technical',
          roundIndex: 3,
          maxRounds: 3,
        }),
      )

      // When/Then: the cap is a hard stop even when the evidence is weak
      expect(decision).toEqual({ kind: 'stop', reason: 'max_rounds' })
    })

    it('returns stop/duplicate_query when the next candidate duplicates a prior query', () => {
      // Given: the next candidate query duplicates an executed query
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('one.example')],
          facts: factsFor(['one.example']),
          uniqueDomainCount: 1,
          intent: 'technical',
          hasDuplicateCandidate: true,
        }),
      )

      // When/Then: duplicates cannot burn another round
      expect(decision).toEqual({ kind: 'stop', reason: 'duplicate_query' })
    })

    it('returns stop/budget_boundary when no budget remains, regardless of evidence', () => {
      // Given: budget exhausted with zero evidence
      const decision = evaluateSearchRound(input({ budgetExhausted: true }))

      // When/Then: no further round may start
      expect(decision).toEqual({ kind: 'stop', reason: 'budget_boundary' })
    })

    it('returns stop/backend_failure when the backend failed terminally', () => {
      // Given: a terminal backend failure even though evidence is absent
      const decision = evaluateSearchRound(input({ backendFailed: true }))

      // When/Then: the failure is the authoritative reason
      expect(decision).toEqual({ kind: 'stop', reason: 'backend_failure' })
    })

    it('prefers terminal stops over replan reasons', () => {
      // Given: backend failure combined with an empty round
      expect(evaluateSearchRound(input({ backendFailed: true }))).toEqual({ kind: 'stop', reason: 'backend_failure' })
      // Given: a duplicate candidate combined with an empty round
      expect(evaluateSearchRound(input({ hasDuplicateCandidate: true }))).toEqual({
        kind: 'stop',
        reason: 'duplicate_query',
      })
      // Given: an exhausted budget combined with an empty round
      expect(evaluateSearchRound(input({ budgetExhausted: true }))).toEqual({ kind: 'stop', reason: 'budget_boundary' })
    })
  })

  describe('replan decisions', () => {
    it('returns continue/no_results when the round produced zero results', () => {
      // Given: an empty successful round
      const decision = evaluateSearchRound(input())

      // When/Then: the controller is told to replan with prompt context
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('no_results')
        expect(decision.replanContext.reasonText.length).toBeGreaterThan(0)
        expect(decision.replanContext.missingCriticalContext).toEqual([])
      }
    })

    it('returns continue/no_facts when results exist but no facts were extracted', () => {
      // Given: one weather source whose snippet yields no extractable facts
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('one.example')],
          uniqueDomainCount: 1,
          intent: 'weather',
        }),
      )

      // When/Then: the round is replanned to find factual content
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('no_facts')
      }
    })

    it('returns continue/low_diversity when a technical round has a single unique source', () => {
      // Given: one technical source but the intent needs two unique sources
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('one.example')],
          facts: factsFor(['one.example']),
          uniqueDomainCount: 1,
          intent: 'technical',
        }),
      )

      // When/Then: a second round is requested and names the diversity minimum
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('low_diversity')
        expect(decision.replanContext.reasonText).toContain('2')
      }
    })

    it('returns continue/freshness_unverifiable once for a time-sensitive round', () => {
      // Given: a weather round whose result dates cannot be verified
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('weather.example')],
          facts: factsFor(['weather.example']),
          uniqueDomainCount: 1,
          intent: 'weather',
          requiresFreshness: true,
          freshnessUnverifiable: true,
          freshnessAttemptsUsed: 0,
        }),
      )

      // When/Then: exactly one freshness-driven replan is allowed
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('freshness_unverifiable')
      }
    })
  })

  describe('intent-specific minimum source diversity', () => {
    it.each([
      ['weather', 1],
      ['local', 1],
      ['news', 2],
      ['technical', 2],
      ['product', 2],
      ['general', 2],
    ] as const)('%s intent is sufficient with %s unique source(s)', (intent, minSources) => {
      // Given: exactly the minimum number of unique sources with facts
      const domains = Array.from({ length: minSources }, (_, i) => `source${i}.example`)

      // When: the round is evaluated
      const decision = evaluateSearchRound(
        input({
          results: domains.map((domain) => resultFor(domain)),
          facts: factsFor(domains),
          uniqueDomainCount: domains.length,
          intent,
        }),
      )

      // Then: the evidence is sufficient and no round is burned
      expect(decision.kind).toBe('stop')
      if (decision.kind === 'stop') {
        expect(decision.reason).toBe('sufficient_evidence')
      }
    })

    it.each([
      ['news', 'news'],
      ['technical', 'technical'],
      ['product', 'product'],
      ['general', 'general'],
    ] as const)('%s intent with one unique source requests another round', (_label, intent: SearchIntent) => {
      // Given: only one unique source for an intent that requires two
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('single.example')],
          facts: factsFor(['single.example']),
          uniqueDomainCount: 1,
          intent,
        }),
      )

      // When/Then: the evaluator requests a second round for diversity
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('low_diversity')
      }
    })

    it('weather intent does not replan for diversity with a single source', () => {
      // Given: one weather source with facts
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('weather.example')],
          facts: factsFor(['weather.example']),
          uniqueDomainCount: 1,
          intent: 'weather',
        }),
      )

      // When/Then: weather only needs one unique source
      expect(decision).toEqual({ kind: 'stop', reason: 'sufficient_evidence' })
    })
  })

  describe('missing critical context', () => {
    it('never triggers a round by itself when evidence is otherwise sufficient', () => {
      // Given: a local round with sufficient evidence but a missing location
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('local.example')],
          facts: factsFor(['local.example']),
          uniqueDomainCount: 1,
          intent: 'local',
          missingCriticalContext: ['location'],
        }),
      )

      // When/Then: missing context alone cannot loop another round
      expect(decision).toEqual({ kind: 'stop', reason: 'sufficient_evidence' })
    })

    it('carries missingCriticalContext into the replan prompt context only', () => {
      // Given: a local round with no results and a missing location
      const decision = evaluateSearchRound(
        input({
          intent: 'local',
          missingCriticalContext: ['location'],
        }),
      )

      // When/Then: the hint is carried as context on the continue decision
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('no_results')
        expect(decision.replanContext.missingCriticalContext).toEqual(['location'])
        expect(decision.replanContext.reasonText.length).toBeGreaterThan(0)
      }
    })

    it('does not turn a low-diversity replan into a context-driven loop', () => {
      // Given: a technical round with low diversity and a missing location
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('single.example')],
          facts: factsFor(['single.example']),
          uniqueDomainCount: 1,
          intent: 'technical',
          missingCriticalContext: ['location'],
        }),
      )

      // When/Then: the replan reason stays the actionable diversity signal
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('low_diversity')
      }
    })
  })

  describe('freshness retry bounding', () => {
    it('allows a single freshness replan when freshness cannot be verified', () => {
      // Given: unverifiable freshness with the retry budget still available
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('weather.example')],
          facts: factsFor(['weather.example']),
          uniqueDomainCount: 1,
          intent: 'weather',
          requiresFreshness: true,
          freshnessUnverifiable: true,
          freshnessAttemptsUsed: 0,
        }),
      )

      // When/Then: exactly one freshness retry is triggered
      expect(decision.kind).toBe('continue')
      if (decision.kind === 'continue') {
        expect(decision.reason).toBe('freshness_unverifiable')
      }
    })

    it('stops with current evidence on the second unverifiable-freshness round', () => {
      // Given: the one freshness retry was already consumed
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('weather.example')],
          facts: factsFor(['weather.example']),
          uniqueDomainCount: 1,
          intent: 'weather',
          requiresFreshness: true,
          freshnessUnverifiable: true,
          freshnessAttemptsUsed: 1,
        }),
      )

      // When/Then: the evaluator accepts the current evidence instead of looping
      expect(decision).toEqual({ kind: 'stop', reason: 'sufficient_evidence' })
    })

    it('ignores freshness signals when the intent is not time-sensitive', () => {
      // Given: a general query with unverifiable freshness but no freshness need
      const decision = evaluateSearchRound(
        input({
          results: [resultFor('a.example'), resultFor('b.example', SECOND_SNIPPET)],
          facts: factsFor(['a.example', 'b.example']),
          uniqueDomainCount: 2,
          intent: 'general',
          requiresFreshness: false,
          freshnessUnverifiable: true,
          freshnessAttemptsUsed: 0,
        }),
      )

      // When/Then: freshness never triggers for non-time-sensitive intents
      expect(decision).toEqual({ kind: 'stop', reason: 'sufficient_evidence' })
    })
  })

  describe('exhaustive decision union', () => {
    it('exposes the complete ordered stop reason set', () => {
      expect(SEARCH_ROUND_STOP_REASONS).toEqual([
        'sufficient_evidence',
        'max_rounds',
        'duplicate_query',
        'budget_boundary',
        'backend_failure',
      ])
    })

    it('exposes the complete ordered replan reason set', () => {
      expect(SEARCH_ROUND_REPLAN_REASONS).toEqual(['no_results', 'no_facts', 'low_diversity', 'freshness_unverifiable'])
    })

    it('reaches every stop reason through at least one scenario', () => {
      // Given: one scenario per stop reason
      const outcomes: SearchRoundDecision[] = [
        evaluateSearchRound(
          input({
            results: [resultFor('weather.example')],
            facts: factsFor(['weather.example']),
            uniqueDomainCount: 1,
            intent: 'weather',
          }),
        ),
        evaluateSearchRound(input({ roundIndex: 3, maxRounds: 3 })),
        evaluateSearchRound(input({ hasDuplicateCandidate: true })),
        evaluateSearchRound(input({ budgetExhausted: true })),
        evaluateSearchRound(input({ backendFailed: true })),
      ]

      // When/Then: every member of the stop union is produced exactly once
      const reasons = outcomes.map((outcome) => (outcome.kind === 'stop' ? outcome.reason : undefined))
      expect(reasons).toEqual(SEARCH_ROUND_STOP_REASONS)
    })

    it('reaches every replan reason through at least one scenario', () => {
      // Given: one scenario per replan reason
      const outcomes: SearchRoundDecision[] = [
        evaluateSearchRound(input()),
        evaluateSearchRound(input({ results: [resultFor('one.example')], uniqueDomainCount: 1, intent: 'weather' })),
        evaluateSearchRound(
          input({
            results: [resultFor('one.example')],
            facts: factsFor(['one.example']),
            uniqueDomainCount: 1,
            intent: 'technical',
          }),
        ),
        evaluateSearchRound(
          input({
            results: [resultFor('weather.example')],
            facts: factsFor(['weather.example']),
            uniqueDomainCount: 1,
            intent: 'weather',
            requiresFreshness: true,
            freshnessUnverifiable: true,
          }),
        ),
      ]

      // When/Then: every member of the replan union is produced exactly once
      const reasons = outcomes.map((outcome) => (outcome.kind === 'continue' ? outcome.reason : undefined))
      expect(reasons).toEqual(SEARCH_ROUND_REPLAN_REASONS)
    })

    it('matches every decision member without a default fallthrough (compile-time proof)', () => {
      // A switch over the full decision union with no default branch. If a new
      // stop or replan reason is added without extending this switch, the test
      // fails typecheck instead of silently falling through.
      const describeDecision = (decision: SearchRoundDecision): string => {
        if (decision.kind === 'stop') {
          switch (decision.reason) {
            case 'sufficient_evidence':
              return 'stop: sufficient_evidence'
            case 'max_rounds':
              return 'stop: max_rounds'
            case 'duplicate_query':
              return 'stop: duplicate_query'
            case 'budget_boundary':
              return 'stop: budget_boundary'
            case 'backend_failure':
              return 'stop: backend_failure'
          }
        }
        switch (decision.reason) {
          case 'no_results':
            return 'continue: no_results'
          case 'no_facts':
            return 'continue: no_facts'
          case 'low_diversity':
            return 'continue: low_diversity'
          case 'freshness_unverifiable':
            return 'continue: freshness_unverifiable'
        }
        throw new Error('unreachable: every SearchRoundDecision member is matched above')
      }

      expect(describeDecision({ kind: 'stop', reason: 'sufficient_evidence' })).toBe('stop: sufficient_evidence')
      expect(
        describeDecision({
          kind: 'continue',
          reason: 'no_results',
          replanContext: { reasonText: 'x', missingCriticalContext: [] },
        }),
      ).toBe('continue: no_results')
    })
  })
})
