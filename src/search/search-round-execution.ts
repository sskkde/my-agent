/**
 * Round loop for the multi-round search controller.
 *
 * Runs the bounded per-round loop (phase1 query race + duplicate gate, backend
 * race, result merge, evaluator decision) against a `RoundExecution` context
 * created by `search-round-context.ts`. Returns a discriminated outcome so the
 * controller can assemble the final result.
 */

import { raceWithDeadline } from './search-round-budget.js'
import { evaluateSearchRound } from './search-round-evaluator.js'
import { isDuplicateQuery } from './search-query-dedup.js'
import { mergeRoundResults } from './search-round-results.js'
import { checkFreshnessWarning, countUniqueSources, extractFacts } from './search-result-processing.js'
import { runQueryPhase } from './search-query-phase.js'
import { DEGRADED_ANSWER } from './search-answer-phase.js'
import { buildReplanDynamicContext, executionMetadata } from './search-multi-round-helpers.js'
import type { RoundExecution } from './search-round-context.js'
import type { SearchSubagentInput, SearchSubagentResult } from './search-subagent.js'
import type { SearchQueryPlan } from './search-subagent-types.js'

export type RoundLoopOutcome =
  | { kind: 'terminal'; result: SearchSubagentResult }
  | { kind: 'timeout' }
  | { kind: 'phase2' }

/**
 * Run the bounded round loop (phase1 -> backend -> evaluator) until a stop
 * decision, a budget boundary, or the maximum round count. `terminal` carries
 * an already-assembled result (phase1 failure, backend failure, external
 * abort); `timeout` means the round deadline settled with zero evidence;
 * `phase2` means the caller should run the single final synthesis.
 */
export async function runRoundLoop(
  execution: RoundExecution,
  input: SearchSubagentInput,
  plan: SearchQueryPlan,
): Promise<RoundLoopOutcome> {
  const {
    deps,
    state,
    countingLlmAdapter,
    remainingRoundMs,
    emitPhase1,
    emitBackendSearch,
    emitEvaluation,
    emitReplan,
  } = execution
  const { webSearchExecutor, modelInputBuilder } = deps
  const maxRounds = Math.min(deps.roundPolicy.maxRounds, deps.roundPolicy.maxReplans + 1)

  while (state.roundCount < maxRounds) {
    const roundIndex = state.roundCount + 1

    if (roundIndex > 1) {
      emitReplan(roundIndex)
    }

    const dynamicContextItems =
      roundIndex > 1
        ? buildReplanDynamicContext(
            roundIndex,
            deps.roundPolicy.maxRounds,
            Math.max(0, deps.roundPolicy.maxReplans - (roundIndex - 1)),
            plan,
            state.seenQueries,
            state.replanContext,
            state.mergedResults,
          )
        : undefined

    const queryPhaseRace = await raceWithDeadline(
      runQueryPhase(
        { llmAdapter: countingLlmAdapter, modelInputBuilder, searchLlmModel: deps.searchLlmModel },
        { input, providerFamily: deps.providerFamily, dynamicContextItems },
      ),
      remainingRoundMs(),
      { signal: input.signal },
    )

    if (queryPhaseRace.kind === 'aborted') {
      return {
        kind: 'terminal',
        result: { success: false, errorCode: 'SEARCH_TIMEOUT', message: 'Search execution was aborted' },
      }
    }
    if (queryPhaseRace.kind === 'expired') {
      state.budgetExhausted = true
      state.stopReason = 'budget_boundary'
      emitEvaluation(roundIndex, { kind: 'stop', reason: 'budget_boundary' })
      break
    }

    const queryPhase = queryPhaseRace.value
    if (!queryPhase.ok) {
      return {
        kind: 'terminal',
        result: { success: false, errorCode: queryPhase.errorCode, message: queryPhase.message },
      }
    }

    if (roundIndex >= 2) {
      const duplicate = isDuplicateQuery(queryPhase.searchQuery, state.seenQueries)
      if (duplicate.kind !== 'unique') {
        state.stopReason = 'duplicate_query'
        emitEvaluation(roundIndex, { kind: 'stop', reason: 'duplicate_query' })
        break
      }
    }

    state.seenQueries.push(queryPhase.searchQuery)
    state.cachedSegmentAHash = queryPhase.segmentAHash
    emitPhase1(roundIndex, queryPhase.searchQuery, queryPhase.querySource)

    const backendRace = await raceWithDeadline(
      webSearchExecutor({ query: queryPhase.searchQuery }),
      remainingRoundMs(),
      { signal: input.signal },
    )

    if (backendRace.kind === 'aborted') {
      return {
        kind: 'terminal',
        result: { success: false, errorCode: 'SEARCH_TIMEOUT', message: 'Search execution was aborted' },
      }
    }
    if (backendRace.kind === 'expired') {
      state.budgetExhausted = true
      state.stopReason = 'budget_boundary'
      emitEvaluation(roundIndex, { kind: 'stop', reason: 'budget_boundary' })
      break
    }

    const toolResult = backendRace.value
    state.searchCallCount += 1
    state.roundCount += 1
    emitBackendSearch(roundIndex)

    if (toolResult.success === false) {
      state.stopReason = 'backend_failure'
      emitEvaluation(roundIndex, { kind: 'stop', reason: 'backend_failure' })
      return {
        kind: 'terminal',
        result: {
          success: true,
          answer: DEGRADED_ANSWER,
          toolResult,
          metadata: {
            providerId: deps.searchLlmProviderId,
            model: deps.searchLlmModel,
            querySource: 'search_subagent',
            durationMs: Date.now() - state.startTime,
            segmentAHash: state.cachedSegmentAHash,
            ...executionMetadata(state),
          },
        },
      }
    }

    state.mergedResults = mergeRoundResults(state.mergedResults, toolResult.results)

    const decision = evaluateSearchRound({
      results: state.mergedResults,
      facts: extractFacts(state.mergedResults),
      uniqueDomainCount: countUniqueSources(state.mergedResults),
      intent: plan.intent,
      requiresFreshness: plan.requiresFreshness,
      roundIndex,
      maxRounds: deps.roundPolicy.maxRounds,
      hasDuplicateCandidate: false,
      budgetExhausted: false,
      backendFailed: false,
      freshnessAttemptsUsed: state.freshnessAttemptsUsed,
      freshnessUnverifiable: checkFreshnessWarning(plan, state.mergedResults).length > 0,
      missingCriticalContext: plan.missingCriticalContext,
    })

    if (decision.kind === 'stop') {
      state.stopReason = decision.reason
      emitEvaluation(roundIndex, decision)
      break
    }

    state.replanCount += 1
    state.replanContext = decision.replanContext
    state.replanReason = decision.reason
    if (decision.reason === 'freshness_unverifiable') {
      state.freshnessAttemptsUsed += 1
    }
    emitEvaluation(roundIndex, decision)
  }

  if (state.budgetExhausted && state.mergedResults.length === 0) {
    return { kind: 'timeout' }
  }
  return { kind: 'phase2' }
}
