import type {
  SearchSubagent,
  SearchSubagentInput,
  SearchSubagentResult,
  SearchSubagentSuccessResult,
  SearchSubagentExecutionMetadata,
} from './search-subagent.js'
import type { WebSearchResultItem } from './types.js'
import type {
  SearchQueryPlan,
  SearchIntent,
  SearchPlanHints,
  ExtractedFact,
  SearchWarning,
  SearchSubagentToolResult,
  SearchSubagentMetadata,
} from './search-subagent-types.js'
import { assertSearchScope } from './search-subagent-types.js'
import { determineEvidenceSufficiency } from './evidence-sufficiency.js'
import { DefaultSearchQueryPlanner } from './search-query-planner.js'
import { SOURCE_QUALITY_SCORING_VERSION } from './source-quality.js'
import {
  checkFreshnessWarning,
  cleanSnippets,
  countUniqueSources,
  deduplicateResults,
  extractFacts,
  rankSearchResults,
  scoreSearchResult,
  selectSearchResults,
} from './search-result-processing.js'
import {
  createSuccessResult,
  createErrorResult,
  type ForegroundToolResult,
} from '../foreground/tools/foreground-tool-result.js'
import { toChildTaskTerminalError } from '../foreground/tools/child-task-contract.js'
import type { ContextBundle } from '../context/types.js'
import type { ChildSessionTaskRuntime } from '../subagents/child-session-task-runtime.js'
import { waitForChildExecution } from '../subagents/child-session-task-runtime.js'
import { ChildTaskRuntimeError } from '../subagents/child-session-task-runtime.js'
import { ChildTaskPolicyError } from '../subagents/child-task-policy.js'
import { SEARCH_CHILD_PROFILE_ID } from '../subagents/child-task-policy.js'
import type { SubagentRunStore } from '../storage/subagent-run-store.js'
import type { SessionStore } from '../storage/session-store.js'

export const SEARCH_SUBAGENT_TOOL_ID = 'search_subagent' as const
export const SEARCH_RESULT_RANKING_VERSION = 'relevance-source-quality-v1' as const
export { cleanSnippets, deduplicateResults, extractFacts, scoreSearchResult }

/** Default foreground budget for the search child wait when the parent turn does not supply one. */
export const DEFAULT_SEARCH_CHILD_WAIT_MS = 60000

export interface SearchSubagentToolInput {
  originalQuestion: string
  intent?: SearchIntent
  locale?: string
  freshnessRequired?: boolean
  /** Optional child-session task ID. When provided, the search resumes the existing search child session (additive; wired by the child-session runner). */
  taskId?: string
}

export interface SearchQueryPlanner {
  plan(input: SearchSubagentToolInput): SearchQueryPlan
}

export interface SearchResultNormalizer {
  extractFacts(results: WebSearchResultItem[]): ExtractedFact[]
}

export interface SearchSubagentToolDeps {
  searchSubagent: SearchSubagent
  queryPlanner: SearchQueryPlanner
  resultNormalizer: SearchResultNormalizer
  scopeGuard: typeof assertSearchScope
  /**
   * Unified child-session runtime. When wired (Todo 16), search runs inside a
   * resumable search child session; otherwise the legacy synchronous path runs
   * byte-identically.
   */
  childSessionTaskRuntime?: ChildSessionTaskRuntime
  /** Parent session store used to resolve child depth for policy enforcement. */
  sessionStore?: SessionStore
  /** Store used to count child launches already made in this parent turn. */
  subagentRunStore?: SubagentRunStore
  /** Remaining parent-turn budget (ms) for the search child wait. */
  childTaskRemainingTimeoutMs?: number
}

/** Per-call tool identity for the child-session path. */
export interface SearchSubagentToolCallContext {
  userId: string
  sessionId: string
  turnId: string
  signal?: AbortSignal
}

export async function handleSearchSubagentTool(
  deps: SearchSubagentToolDeps,
  input: SearchSubagentToolInput,
  ctx?: SearchSubagentToolCallContext,
): Promise<ForegroundToolResult<SearchSubagentToolResult>> {
  const startTime = Date.now()

  try {
    deps.scopeGuard('web_search')

    const plan = deps.queryPlanner.plan(input)
    const effectiveQuery =
      typeof plan.searchQuery === 'string' && plan.searchQuery.trim().length > 0
        ? plan.searchQuery.trim()
        : input.originalQuestion.trim()
    if (!effectiveQuery) {
      return createErrorResult<SearchSubagentToolResult>(
        'INVALID_TOOL_CALL',
        'Search query is empty',
        true,
        'Search failed: empty query',
      )
    }

    // Unified child-session path (Todo 16): run the search inside a resumable
    // search child session. The parent still receives the byte-compatible
    // SearchSubagentToolResult through this same public tool.
    if (deps.childSessionTaskRuntime && deps.sessionStore && deps.subagentRunStore && ctx?.sessionId) {
      return await runSearchChildSession(deps, input, plan, effectiveQuery, ctx, startTime)
    }

    const searchInput: SearchSubagentInput = {
      query: effectiveQuery,
      userId: 'tool-invocation',
      sessionId: 'tool-invocation',
    }

    const searchResult: SearchSubagentResult = await deps.searchSubagent.execute(searchInput)
    if (!searchResult.success) {
      return createErrorResult<SearchSubagentToolResult>(
        searchResult.errorCode,
        searchResult.message,
        true,
        `Search failed: ${searchResult.message}`,
      )
    }

    return buildSearchToolResult(deps, plan, effectiveQuery, searchResult, Date.now() - startTime)
  } catch (error) {
    if (error instanceof Error && error.name === 'SearchSubagentScopeError') {
      return createErrorResult<SearchSubagentToolResult>(
        'NON_SEARCH_TOOL_NOT_ALLOWED',
        error.message,
        false,
        'Search scope violation: attempted to use non-search tool.',
      )
    }

    return createErrorResult<SearchSubagentToolResult>(
      'SEARCH_SUBAGENT_ERROR',
      error instanceof Error ? error.message : 'Unknown search error',
      true,
      'An error occurred while searching.',
      {
        toolCallSummaries: [
          {
            toolCallId: `search-error-${Date.now()}`,
            toolName: SEARCH_SUBAGENT_TOOL_ID,
            status: 'failed',
          },
        ],
      },
    )
  }
}

// ---------------------------------------------------------------------------
// Child-session search path (Todo 16)
// ---------------------------------------------------------------------------

async function runSearchChildSession(
  deps: SearchSubagentToolDeps,
  input: SearchSubagentToolInput,
  plan: SearchQueryPlan,
  effectiveQuery: string,
  ctx: SearchSubagentToolCallContext,
  startTime: number,
): Promise<ForegroundToolResult<SearchSubagentToolResult>> {
  const runtime = deps.childSessionTaskRuntime!
  const sessionStore = deps.sessionStore!
  const runStore = deps.subagentRunStore!
  const remainingMs = deps.childTaskRemainingTimeoutMs ?? DEFAULT_SEARCH_CHILD_WAIT_MS

  const parentContext: ContextBundle = {
    bundleId: `bundle-${ctx.turnId}`,
    runId: ctx.turnId,
    agentId: 'foreground',
    agentType: 'main',
    userId: ctx.userId,
    invocationSource: 'gateway_intent',
    pinnedItems: [],
    orderedItems: [],
    tokenEstimate: 0,
  }

  const depth = (sessionStore.getById(ctx.sessionId)?.subagentDepth ?? 0) + 1
  const launches = runStore.query({ userId: ctx.userId, parentRunId: ctx.turnId }).length

  let launch
  try {
    const searchPlanHints: SearchPlanHints = {
      originalQuestion: plan.originalQuestion,
      intent: plan.intent,
      freshness: plan.requiresFreshness,
      missingCriticalContext: plan.missingCriticalContext,
      ...(plan.locale !== undefined ? { locale: plan.locale } : {}),
    }
    launch = runtime.launchTask({
      parentContext,
      taskSpec: {
        objective: effectiveQuery,
        profileId: SEARCH_CHILD_PROFILE_ID,
        tools: ['web_search'],
        parentSessionId: ctx.sessionId,
        parentTurnId: ctx.turnId,
        launchMode: 'foreground',
        timeoutMs: remainingMs,
        prompt:
          'You are a search assistant. Search the web for the given question and synthesize a concise answer. Only the web_search tool is available.',
        searchPlanHints,
      },
      depth,
      launchesInParentTurn: launches,
      requestedTools: ['web_search'],
      parentRunId: ctx.turnId,
      rootRunId: ctx.turnId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
    })
  } catch (error) {
    const terminal = toChildTaskTerminalError(error, {
      code:
        error instanceof ChildTaskPolicyError || error instanceof ChildTaskRuntimeError
          ? error.code
          : 'CHILD_TASK_LAUNCH_FAILED',
      recoverable: true,
      phase: 'launch',
    })
    return createErrorResult<SearchSubagentToolResult>(
      terminal.code,
      terminal.message,
      terminal.recoverable,
      `Search failed: ${terminal.message}`,
    )
  }

  const wait = await waitForChildExecution(runtime, launch.subagentRunId, remainingMs, ctx.signal)

  if (wait.outcome === 'timeout') {
    return createErrorResult<SearchSubagentToolResult>(
      'SEARCH_TIMEOUT',
      `Search task ${launch.taskId} exceeded the remaining budget (${remainingMs}ms)`,
      true,
      'Search timed out.',
    )
  }

  if (wait.outcome === 'aborted' || wait.result.status === 'cancelled') {
    return createErrorResult<SearchSubagentToolResult>(
      'CANCELLED',
      'Search task was cancelled',
      true,
      'Search cancelled.',
    )
  }

  const result = wait.result
  if (result.status !== 'completed' || !result.structuredResult) {
    const code = result.error?.code ?? 'SEARCH_SUBAGENT_ERROR'
    const message = result.error?.message ?? 'Search task failed'
    const recoverable = result.error?.recoverable ?? result.status === 'failed'
    return createErrorResult<SearchSubagentToolResult>(code, message, recoverable, `Search failed: ${message}`)
  }

  return buildSearchToolResult(
    deps,
    plan,
    effectiveQuery,
    result.structuredResult as SearchSubagentSuccessResult,
    Date.now() - startTime,
    launch.taskId,
  )
}

// ---------------------------------------------------------------------------
// Shared post-processing (byte-identical evidence for BOTH the legacy and the
// child-session path)
// ---------------------------------------------------------------------------

function buildSearchToolResult(
  deps: SearchSubagentToolDeps,
  plan: SearchQueryPlan,
  effectiveQuery: string,
  searchResult: SearchSubagentSuccessResult,
  durationMs: number,
  taskId?: string,
): ForegroundToolResult<SearchSubagentToolResult> {
  const deduplicated = deduplicateResults(searchResult.toolResult.results)
  const cleaned = cleanSnippets(deduplicated)
  const sorted = rankSearchResults(cleaned, plan)
  const cropped = selectSearchResults(sorted)
  const extractedFacts = deps.resultNormalizer.extractFacts(cropped)
  const warnings = checkFreshnessWarning(plan, cropped)
  const metadata = buildSearchMetadata(durationMs, cropped, extractedFacts, warnings, plan, searchResult.metadata)
  if (taskId !== undefined) metadata.taskId = taskId

  return createSuccessResult<SearchSubagentToolResult>(
    {
      originalQuestion: plan.originalQuestion,
      searchQuery: effectiveQuery,
      intent: plan.intent,
      freshness: plan.requiresFreshness,
      locale: plan.locale,
      results: cropped,
      extractedFacts,
      warnings,
      metadata,
      queryPlan: plan,
    },
    `Found ${cropped.length} results for "${plan.searchQuery}"`,
    {
      toolCallSummaries: [
        {
          toolCallId: `search-${Date.now()}`,
          toolName: SEARCH_SUBAGENT_TOOL_ID,
          status: 'completed',
        },
      ],
    },
  )
}

function buildSearchMetadata(
  durationMs: number,
  results: readonly WebSearchResultItem[],
  facts: readonly ExtractedFact[],
  warnings: readonly SearchWarning[],
  plan: SearchQueryPlan,
  internalExecution?: SearchSubagentExecutionMetadata,
): SearchSubagentMetadata {
  const metadata: SearchSubagentMetadata = {
    durationMs,
    resultCount: results.length,
    uniqueSourceCount: countUniqueSources(results),
    rankingVersion: SEARCH_RESULT_RANKING_VERSION,
    sourceQualityVersion: SOURCE_QUALITY_SCORING_VERSION,
    evidenceSufficiency: determineEvidenceSufficiency(results, facts, warnings, plan),
    searchCallCount: internalExecution?.searchCallCount ?? 1,
  }

  // Multi-round executions only: the default one-round path never emits
  // stopReason/budgetExhausted and stays at roundCount 1, so copying is gated
  // on a real multi-round run. executedQueries stays internal-only.
  const isMultiRound =
    (internalExecution?.roundCount ?? 1) > 1 ||
    internalExecution?.stopReason !== undefined ||
    internalExecution?.budgetExhausted === true
  if (!isMultiRound) return metadata

  if (internalExecution?.roundCount !== undefined) metadata.roundCount = internalExecution.roundCount
  if (internalExecution?.replanCount !== undefined) metadata.replanCount = internalExecution.replanCount
  if (internalExecution?.llmCallCount !== undefined) metadata.llmCallCount = internalExecution.llmCallCount
  if (internalExecution?.stopReason !== undefined) metadata.stopReason = internalExecution.stopReason
  if (internalExecution?.budgetExhausted === true) metadata.budgetExhausted = true

  return metadata
}

export { DefaultSearchQueryPlanner }

export class DefaultSearchResultNormalizer implements SearchResultNormalizer {
  extractFacts(results: WebSearchResultItem[]): ExtractedFact[] {
    return extractFacts(results)
  }
}
