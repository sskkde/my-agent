/**
 * Controlled multi-round search controller.
 *
 * Thin orchestrator for bounded multi-round execution when
 * `roundPolicy.maxRounds > 1`: resolves the plan/budget/deadlines, runs the
 * per-round loop (see `search-round-execution.ts`), then runs the single final
 * phase2 synthesis over the merged/cropped evidence. Deadline settling is
 * PIPELINE-level abandonment (never transport cancellation): a late provider
 * promise can never surface as an unhandled rejection or schedule later work.
 */

import { computeRoundDeadlines, raceWithDeadline } from './search-round-budget.js'
import { prepareSynthesisResults } from './search-round-results.js'
import { DEGRADED_ANSWER, runAnswerPhase } from './search-answer-phase.js'
import {
  DEFAULT_SEARCH_TOTAL_BUDGET_MS,
  buildControllerPlan,
  executionMetadata,
  finalToolResult,
} from './search-multi-round-helpers.js'
import { createRoundExecution } from './search-round-context.js'
import type { RoundExecution, RoundExecutionDeps } from './search-round-context.js'
import { runRoundLoop } from './search-round-execution.js'
import type { SearchSubagentInput, SearchSubagentResult, SearchSubagentSuccessResult } from './search-subagent.js'
import type { SearchQueryPlan } from './search-subagent-types.js'

export type MultiRoundControllerDeps = RoundExecutionDeps

/**
 * Run the bounded multi-round search. The caller (the facade) invokes this only
 * when `roundPolicy.maxRounds > 1`, so the default one-round path stays
 * byte-identical.
 */
export async function runMultiRoundSearch(
  deps: MultiRoundControllerDeps,
  input: SearchSubagentInput,
): Promise<SearchSubagentResult> {
  const startTime = Date.now()
  const plan = buildControllerPlan(input, input.searchPlanHints)
  const totalBudgetMs = input.timeoutMs ?? DEFAULT_SEARCH_TOTAL_BUDGET_MS
  const { roundDeadlineMs, completionDeadlineMs } = computeRoundDeadlines(totalBudgetMs, deps.roundPolicy)
  const execution = createRoundExecution(deps, startTime, roundDeadlineMs, completionDeadlineMs)

  const outcome = await runRoundLoop(execution, input, plan)
  if (outcome.kind === 'terminal') {
    return outcome.result
  }
  if (outcome.kind === 'timeout') {
    return {
      success: false,
      errorCode: 'SEARCH_TIMEOUT',
      message: 'Search exceeded its time budget before any results were returned',
    }
  }
  return runFinalPhase2(execution, input, plan)
}

async function runFinalPhase2(
  execution: RoundExecution,
  input: SearchSubagentInput,
  plan: SearchQueryPlan,
): Promise<SearchSubagentResult> {
  const { deps, state, countingLlmAdapter, remainingCompletionMs } = execution
  const { modelInputBuilder } = deps

  const preparedResults = prepareSynthesisResults(state.mergedResults, plan)
  const phase2ToolResult = finalToolResult(plan, preparedResults)

  const answerRace = await raceWithDeadline(
    runAnswerPhase(
      {
        llmAdapter: countingLlmAdapter,
        modelInputBuilder,
        searchLlmModel: deps.searchLlmModel,
        phaseObserver: deps.phaseObserver,
      },
      {
        input,
        providerFamily: deps.providerFamily,
        searchLlmProviderId: deps.searchLlmProviderId,
        toolResult: phase2ToolResult,
        searchQuery: plan.originalQuestion,
        cachedSegmentAHash: state.cachedSegmentAHash,
        startTime: state.startTime,
      },
    ),
    remainingCompletionMs(),
    { signal: input.signal },
  )

  if (answerRace.kind === 'aborted') {
    return { success: false, errorCode: 'SEARCH_TIMEOUT', message: 'Search execution was aborted' }
  }

  let answerResult: SearchSubagentSuccessResult
  if (answerRace.kind === 'expired') {
    state.budgetExhausted = true
    answerResult = {
      success: true,
      answer: DEGRADED_ANSWER,
      toolResult: finalToolResult(plan, state.mergedResults),
      metadata: {
        providerId: deps.searchLlmProviderId,
        model: deps.searchLlmModel,
        querySource: 'search_subagent',
        durationMs: Date.now() - state.startTime,
        segmentAHash: state.cachedSegmentAHash,
      },
    }
  } else {
    answerResult = answerRace.value
  }

  return {
    ...answerResult,
    toolResult: finalToolResult(plan, state.mergedResults),
    metadata: {
      ...answerResult.metadata,
      ...executionMetadata(state),
    },
  }
}
