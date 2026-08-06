/**
 * Specialized search child runner (Todo 16 of opencode-like-subagent-sessions).
 *
 * Runs a SEARCH child task through the EXISTING two-phase search executor
 * (`createSearchSubagent`) instead of a generic kernel loop. The runtime
 * (`ChildSessionTaskRuntime.executeRun`) delegates here when the run's profile
 * is the search profile; the public `search_subagent` tool keeps returning the
 * byte-compatible `SearchSubagentToolResult`.
 *
 * Responsibilities:
 *   - reuse the two-phase executor verbatim (forced web_search tool_choice ->
 *     auto retry -> input fallback, direct backend execution, Phase-2
 *     structured_json answer, Segment-A hash comparison, provider/model
 *     precedence resolved by the executor's config resolvers)
 *   - record the two-phase milestones + safe backend errors on the CHILD
 *     timeline (never raw provider bodies / CAPTCHA / stack traces)
 *   - return a `SubagentResult` whose `structuredResult` carries the raw
 *     `SearchSubagentSuccessResult` so the parent tool can run its post-
 *     processing (dedup/rank/crop/facts/warnings/metadata) unchanged
 *   - timeout / backend-failure / invalid-tool-call are typed and safe:
 *     recoverable where appropriate, non-recoverable for model errors
 *
 * Wiring note: `createSearchPhaseRecorder` returns a standalone recorder so the
 * caller can build the `SearchSubagent` WITH `phaseObserver: recorder.observe`
 * and THEN construct the runner - no circular construction.
 */

import type { SubagentResult } from '../subagents/types.js'
import type { SubagentTranscriptStore } from '../storage/subagent-transcript-store.js'
import { sanitizeErrorMessage } from '../tools/error-sanitizer.js'
import type { SearchSubagent, SearchSubagentInput, SearchSubagentSuccessResult } from './search-subagent.js'
import type { SearchPhaseObservation } from './search-subagent.js'
import type { SearchPlanHints } from './search-subagent-types.js'
import type { WebSearchResult } from './types.js'

export const SEARCH_TIMEOUT = 'SEARCH_TIMEOUT'
export const SEARCH_BACKEND_ERROR = 'SEARCH_BACKEND_ERROR'
export const SEARCH_EXECUTION_ERROR = 'SEARCH_EXECUTION_ERROR'

/** When a timeout budget is exceeded. */
class SearchRunTimeoutError extends Error {
  readonly code = SEARCH_TIMEOUT
  constructor() {
    super('Search child task exceeded its timeout budget')
    this.name = 'SearchRunTimeoutError'
  }
}

/** Identity of the search child run currently executing (for phase recording). */
export interface SearchChildRunIdentity {
  subagentRunId: string
  childSessionId: string
  userId: string
  tenantId: string
}

/**
 * Records search phases + safe errors on the child timeline. A single recorder
 * is shared between the runner and the `createSearchSubagent` phase observer.
 */
export interface SearchChildRecorder {
  /** Wire into `createSearchSubagent({ phaseObserver })`. */
  observe: (observation: SearchPhaseObservation) => void
  /** Persist one transcript event on the ACTIVE search child run. */
  record: (eventType: string, content: unknown) => void
  setActive: (ctx: SearchChildRunIdentity | undefined) => void
}

export function createSearchPhaseRecorder(transcriptStore: SubagentTranscriptStore): SearchChildRecorder {
  let active: SearchChildRunIdentity | undefined

  const record: SearchChildRecorder['record'] = (eventType, content) => {
    if (!active) return
    try {
      transcriptStore.append(
        {
          id: `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          subagentRunId: active.subagentRunId,
          eventType,
          contentJson: JSON.stringify(content),
          createdAt: new Date().toISOString(),
          tenantId: active.tenantId,
          sessionId: active.childSessionId,
          userId: active.userId,
        },
        active.tenantId,
      )
    } catch {
      // Best-effort timeline persistence — an observability failure must not
      // fail the child run (project anti-pattern #11).
    }
  }

  return {
    observe: (observation) => {
      if (!active) return
      record('SearchPhase', {
        phase: observation.phase,
        query: observation.query,
        querySource: observation.querySource,
        ...(observation.round !== undefined ? { round: observation.round } : {}),
        ...(observation.stopReason !== undefined ? { stopReason: observation.stopReason } : {}),
        ...(observation.replanReason !== undefined ? { replanReason: observation.replanReason } : {}),
        ...(observation.roundCount !== undefined ? { roundCount: observation.roundCount } : {}),
        ...(observation.searchCallCount !== undefined ? { searchCallCount: observation.searchCallCount } : {}),
        ...(observation.llmCallCount !== undefined ? { llmCallCount: observation.llmCallCount } : {}),
      })
    },
    record,
    setActive: (ctx) => {
      active = ctx
    },
  }
}

export interface SearchChildRunnerDeps {
  /** Two-phase search executor (built via createSearchSubagent). */
  searchSubagent: SearchSubagent
  /** Shared child-timeline recorder (must be the SAME instance wired into createSearchSubagent.phaseObserver). */
  recorder: SearchChildRecorder
}

export interface SearchChildRunInput {
  subagentRunId: string
  childSessionId: string
  userId: string
  tenantId: string
  /** The effective search query (the child task objective). */
  query: string
  /** Typed plan hints normalized at the persisted-task boundary (absent for legacy specs). */
  searchPlanHints?: SearchPlanHints
  /** Optional timeout budget - the runner resolves SEARCH_TIMEOUT when exceeded. */
  timeoutMs?: number
  signal?: AbortSignal
}

export type SearchChildRunner = (input: SearchChildRunInput) => Promise<SubagentResult>

export function createSearchChildSessionRunner(deps: SearchChildRunnerDeps): SearchChildRunner {
  const { searchSubagent, recorder } = deps

  const run: SearchChildRunner = async (input) => {
    const { subagentRunId, childSessionId, userId, tenantId, query } = input
    const startedAt = new Date().toISOString()
    const identity: SearchChildRunIdentity = { subagentRunId, childSessionId, userId, tenantId }

    const cancelledResult = (): SubagentResult => ({
      status: 'cancelled',
      response: undefined,
      toolCalls: [],
      error: { code: 'CANCELLED', message: 'Search execution was cancelled' },
      iterationsUsed: 0,
      startedAt,
      completedAt: new Date().toISOString(),
    })

    const failedResult = (code: string, message: string, recoverable: boolean): SubagentResult => ({
      status: 'failed',
      response: undefined,
      toolCalls: [],
      error: { code, message, recoverable },
      iterationsUsed: 0,
      startedAt,
      completedAt: new Date().toISOString(),
    })

    recorder.setActive(identity)
    try {
      if (input.signal?.aborted) return cancelledResult()

      recorder.record('SearchPhaseStarted', { phase: 'phase1_tool_call' })

      let searchResult
      try {
        const executeInput: SearchSubagentInput & { searchPlanHints?: SearchPlanHints } = {
          query,
          userId,
          sessionId: childSessionId,
          ...(input.searchPlanHints !== undefined ? { searchPlanHints: input.searchPlanHints } : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
        }
        searchResult = await withRunTimeout(searchSubagent.execute(executeInput), input.timeoutMs, input.signal)
      } catch (error) {
        if (input.signal?.aborted) return cancelledResult()
        if (error instanceof SearchRunTimeoutError) {
          recorder.record('SearchPhaseFailed', { phase: 'timeout', errorCode: SEARCH_TIMEOUT, message: error.message })
          return failedResult(SEARCH_TIMEOUT, error.message, true)
        }
        const message = sanitizeErrorMessage(error instanceof Error ? error.message : 'Search child execution failed')
        recorder.record('SearchPhaseFailed', { phase: 'execution', errorCode: SEARCH_EXECUTION_ERROR, message })
        return failedResult(SEARCH_EXECUTION_ERROR, message, true)
      }

      if (input.signal?.aborted) return cancelledResult()

      if (!searchResult.success) {
        const message = sanitizeErrorMessage(searchResult.message)
        const recoverable =
          searchResult.errorCode !== 'INVALID_TOOL_CALL' && searchResult.errorCode !== 'SEARCH_MODEL_INCAPABLE'
        recorder.record('SearchPhaseFailed', { phase: 'execution', errorCode: searchResult.errorCode, message })
        return failedResult(searchResult.errorCode, message, recoverable)
      }

      // A direct search backend that returned no usable results is a typed,
      // recoverable backend failure - the parent must never see raw provider
      // logs or CAPTCHA details.
      const toolResult = searchResult.toolResult as WebSearchResult & { success?: boolean }
      if (toolResult.success === false) {
        const message = 'Web search backend was unavailable; no results were returned.'
        recorder.record('SearchBackendError', { errorCode: SEARCH_BACKEND_ERROR, message })
        return failedResult(SEARCH_BACKEND_ERROR, message, true)
      }

      const completedAt = new Date().toISOString()
      const executedQueries = searchResult.metadata.executedQueries
      const toolCalls: SubagentResult['toolCalls'] =
        executedQueries && executedQueries.length > 0
          ? executedQueries.map((executedQuery, index) => ({
              toolCallId: `search-${Date.now()}-${index + 1}`,
              toolName: 'web_search',
              params: { query: executedQuery },
            }))
          : [{ toolCallId: `search-${Date.now()}`, toolName: 'web_search', params: { query } }]
      const iterationsUsed = searchResult.metadata.llmCallCount ?? 2
      const result: SubagentResult = {
        status: 'completed',
        response: searchResult.answer,
        toolCalls,
        iterationsUsed,
        startedAt,
        completedAt,
        structuredResult: searchResult,
      }
      recorder.record('SearchPhaseCompleted', {
        phase: 'complete',
        providerId: searchResult.metadata.providerId,
        model: searchResult.metadata.model,
        querySource: searchResult.metadata.querySource,
        ...(searchResult.metadata.roundCount !== undefined ? { roundCount: searchResult.metadata.roundCount } : {}),
        ...(searchResult.metadata.searchCallCount !== undefined
          ? { searchCallCount: searchResult.metadata.searchCallCount }
          : {}),
        ...(searchResult.metadata.llmCallCount !== undefined
          ? { llmCallCount: searchResult.metadata.llmCallCount }
          : {}),
      })
      return result
    } finally {
      recorder.setActive(undefined)
    }
  }

  return run
}

/**
 * Resolve the execution promise on completion, or reject with a timeout /
 * abort error while leaving the underlying promise running (no orphan await).
 */
function withRunTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer =
      timeoutMs !== undefined && timeoutMs > 0
        ? setTimeout(() => {
            if (!settled) {
              settled = true
              reject(new SearchRunTimeoutError())
            }
          }, timeoutMs)
        : undefined

    const onAbort = (): void => {
      if (!settled) {
        settled = true
        reject(new SearchRunTimeoutError())
      }
    }

    if (signal?.aborted) onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export type { SearchSubagentSuccessResult }
