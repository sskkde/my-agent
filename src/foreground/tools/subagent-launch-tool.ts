/**
 * Foreground Tool: Launch Subagent
 * Extracted from foreground-kernel-runner handleDispatchSubagent
 */

import type { RuntimeDispatcher, DispatchResult } from '../../dispatcher/types.js'
import type { ForegroundToolResult } from './foreground-tool-result.js'
import { createSuccessResult, createErrorResult } from './foreground-tool-result.js'
import { buildLaunchSubagentAction, inferSubagentType } from '../../subagents/action-mapper.js'
import { normalizeAgentLabel, isKnownAgentLabel } from '../../taxonomy/agent-label-normalizer.js'
import type { AgentProfileRegistry } from '../../taxonomy/agent-profile-registry.js'
import type { ContextBundle } from '../../context/types.js'
import type {
  ChildSessionTaskRuntime,
  ChildTaskLaunchInput,
  ChildTaskSpec,
} from '../../subagents/child-session-task-runtime.js'
import { ChildTaskRuntimeError } from '../../subagents/child-session-task-runtime.js'
import { ChildTaskPolicyError, CHILD_TASK_LAUNCH_SOURCE } from '../../subagents/child-task-policy.js'
import type { SubagentResult } from '../../subagents/types.js'
import type { SubagentRunStore } from '../../storage/subagent-run-store.js'
import type { SessionStore } from '../../storage/session-store.js'
import type { BackgroundRuntime } from '../../subagents/background-runtime.js'
import type { ToolResultStore } from '../../storage/tool-result-store.js'
import { applyBoundedResultPolicy, toChildTaskTerminalError } from './child-task-contract.js'
import { sanitizeErrorMessage } from '../../tools/error-sanitizer.js'
import { processToolOutput } from '../../tools/tool-result-reference.js'

export const LAUNCH_SUBAGENT_TOOL_ID = 'foreground_launch_subagent'

/** Typed terminal error code when the child exceeds the parent turn's remaining budget. */
export const CHILD_TASK_TIMEOUT = 'CHILD_TASK_TIMEOUT'

/**
 * Default foreground child wait budget (ms) when the parent turn does not
 * supply a remaining-budget value. The unified runtime path deliberately
 * honours the parent-turn budget instead of the RuntimeDispatcher 30s default.
 */
export const DEFAULT_FOREGROUND_CHILD_WAIT_MS = 60000

/** Child kernel iteration cap for foreground launches. */
const CHILD_MAX_ITERATIONS = 10

export interface LaunchSubagentDeps {
  runtimeDispatcher: RuntimeDispatcher
  userId: string
  sessionId: string
  turnId: string
  profileRegistry: AgentProfileRegistry
  /** Parent dispatch AbortSignal — cascades cancellation into the child subagent kernel. */
  signal?: AbortSignal
  /**
   * Unified child-session runtime. When wired (Todo 8+), foreground launches
   * run child execution under this runtime and WAIT within the parent turn's
   * remaining budget instead of the RuntimeDispatcher 30s default.
   */
  childSessionTaskRuntime?: ChildSessionTaskRuntime
  /** Remaining parent-turn budget (ms) for the foreground child wait. */
  childTaskRemainingTimeoutMs?: number
  /** Store for persisting large child results by reference (>32KiB). */
  toolResultStore?: ToolResultStore
  /**
   * Todo 9 background machinery. When wired AND `input.background === true`,
   * the launch enqueues a durable background run (full task spec persisted)
   * and returns BEFORE completion; the background worker later creates the
   * child session + run attempt and persists an exactly-once notification.
   */
  backgroundRuntime?: BackgroundRuntime
  /** Store used to count child launches already made in this parent turn. */
  subagentRunStore?: SubagentRunStore
  /** Store used to resolve the parent session depth (child depth = parent + 1). */
  sessionStore?: SessionStore
}

export interface LaunchSubagentInput {
  objective: string
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType?: string
  /** Capability profile identifier. Validated against AgentProfileRegistry. */
  agentProfile?: string
  suggestedTools?: string[]
  /**
   * Optional child-session task ID. When provided, the launch resumes the
   * existing child session instead of creating a fresh one (additive; wired
   * by the child-session runtime, not by this facade).
   */
  taskId?: string
  /**
   * Optional launch mode override. true = background (return immediately,
   * persist an exactly-once completion notification); false/default =
   * foreground (wait for the bounded terminal result).
   */
  background?: boolean
}

export interface LaunchSubagentData {
  runtimeActionId: string
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType: string
  /** Capability profile identifier. */
  agentProfile: string
  dispatchResult: DispatchResult
}

/**
 * Child-session metadata added to the preserved public result on the unified
 * runtime path. The four legacy keys above remain untouched.
 */
export interface ForegroundChildTaskData extends LaunchSubagentData {
  taskId: string
  childSessionId: string
  subagentRunId: string
}

/**
 * Result data for a background launch (`input.background === true`): the four
 * legacy keys plus the enqueued background run id and its status. `taskId` is
 * present ONLY when the launch resumed an existing task — a fresh background
 * child session is created later by the worker.
 */
export interface BackgroundChildTaskData extends LaunchSubagentData {
  backgroundRunId: string
  status: 'queued'
  taskId?: string
}

/**
 * Handle launching a subagent from the foreground.
 * Creates a server-side RuntimeAction and dispatches it to the subagent runtime.
 */
export async function handleLaunchSubagent(
  deps: LaunchSubagentDeps,
  input: LaunchSubagentInput,
): Promise<ForegroundToolResult<LaunchSubagentData>> {
  try {
    const rawLabel = input.agentProfile ?? input.agentType

    let agentProfile: string
    let agentType: string

    if (rawLabel && isKnownAgentLabel(rawLabel)) {
      const normalized = normalizeAgentLabel(rawLabel)
      agentProfile = normalized.agentProfile
      agentType = normalized.agentProfile
    } else if (rawLabel) {
      if (deps.childSessionTaskRuntime) {
        // On the unified child path the child policy (evaluateChildLaunch →
        // SUBAGENT_PROFILE_UNKNOWN) is the authoritative profile gate; deferring
        // to it surfaces the typed code with zero side effects.
        agentProfile = rawLabel
        agentType = rawLabel
      } else {
        deps.profileRegistry.assertAllowed(rawLabel)
        agentProfile = rawLabel
        agentType = rawLabel
      }
    } else {
      const inferred = inferSubagentType({
        message: input.objective,
        suggestedTools: input.suggestedTools,
      })
      agentProfile = inferred.agentProfile
      agentType = inferred.agentProfile
    }

    const parentContext: ContextBundle = {
      bundleId: `bundle-${deps.turnId}`,
      runId: deps.turnId,
      agentId: 'foreground',
      agentType: 'main',
      userId: deps.userId,
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 0,
    }

    const identity = { agentType, agentProfile }

    if (deps.childSessionTaskRuntime) {
      if (!input.background) {
        return await handleForegroundChildWait(deps, input, identity, parentContext)
      }
      if (deps.backgroundRuntime) {
        return await handleBackgroundChildLaunch(deps, input, identity, parentContext)
      }
    }

    return await handleLegacyDispatch(deps, input, identity, parentContext)
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Failed to dispatch subagent'
    return createErrorResult(
      'DISPATCH_SUBAGENT_ERROR',
      sanitizeErrorMessage(rawMessage),
      false,
      'Failed to launch subagent.',
    )
  }
}

async function handleLegacyDispatch(
  deps: LaunchSubagentDeps,
  input: LaunchSubagentInput,
  identity: { agentType: string; agentProfile: string },
  parentContext: ContextBundle,
): Promise<ForegroundToolResult<LaunchSubagentData>> {
  const { agentType, agentProfile } = identity

  const runtimeAction = buildLaunchSubagentAction({
    agentType,
    agentProfile,
    taskSpec: {
      objective: input.objective,
      agentType: agentProfile,
      tools: input.suggestedTools,
    },
    userId: deps.userId,
    sessionId: deps.sessionId,
    parentContext,
    sourceRef: {
      sourceType: 'foreground_turn',
      turnId: deps.turnId,
    },
  })

  const dispatchResult = await deps.runtimeDispatcher.dispatch({
    requestId: deps.turnId,
    action: runtimeAction,
    context: {
      callerModule: 'foreground_subagent_launch_tool',
      userId: deps.userId,
      sessionId: deps.sessionId,
      ...(deps.signal ? { signal: deps.signal } : {}),
    },
  })

  if (dispatchResult.status !== 'completed') {
    const rawMsg = dispatchResult.error?.message || 'Dispatch failed'
    const errorMsg = sanitizeErrorMessage(rawMsg)
    return createErrorResult(
      dispatchResult.error?.code || 'DISPATCH_SUBAGENT_FAILED',
      errorMsg,
      true,
      `Subagent dispatch failed: ${errorMsg}`,
      { runtimeActionIds: [runtimeAction.actionId] },
    )
  }

  return createSuccessResult(
    {
      runtimeActionId: runtimeAction.actionId,
      agentType,
      agentProfile,
      dispatchResult,
    },
    'Subagent launched successfully.',
    {
      runtimeActionIds: [runtimeAction.actionId],
    },
  )
}

// ---------------------------------------------------------------------------
// Unified runtime foreground wait (Todo 8)
// ---------------------------------------------------------------------------

/**
 * Run the child under ChildSessionTaskRuntime and wait for its bounded terminal
 * result within the parent turn's remaining budget.
 *
 * Contract guarantees:
 *  - Success: the preserved public tool result PLUS taskId/childSessionId/
 *    subagentRunId metadata; model-facing content is sanitized and capped at
 *    2,000 chars; structured results at/above 32KiB are persisted by reference
 *    via processToolOutput. Child intermediate transcript / reasoning / tool
 *    calls / raw errors are NEVER injected into the parent model.
 *  - Budget expiry: cancelRun fires (idempotent, aborts the live child kernel —
 *    no orphan), and a typed safe `CHILD_TASK_TIMEOUT` terminal error is
 *    returned. A late terminal can never overwrite the cancelled run.
 *  - Cancellation: the parent AbortSignal aborts the wait immediately and
 *    cancels the child run.
 */
async function handleForegroundChildWait(
  deps: LaunchSubagentDeps,
  input: LaunchSubagentInput,
  identity: { agentType: string; agentProfile: string },
  parentContext: ContextBundle,
): Promise<ForegroundToolResult<LaunchSubagentData>> {
  const runtime = deps.childSessionTaskRuntime!
  const remainingMs = deps.childTaskRemainingTimeoutMs ?? DEFAULT_FOREGROUND_CHILD_WAIT_MS
  const { agentType, agentProfile } = identity

  // Server-side runtime action id keeps the public contract stable (act_* prefix).
  const runtimeAction = buildLaunchSubagentAction({
    agentType,
    agentProfile,
    taskSpec: {
      objective: input.objective,
      agentType: agentProfile,
      tools: input.suggestedTools,
    },
    userId: deps.userId,
    sessionId: deps.sessionId,
    parentContext,
    sourceRef: {
      sourceType: 'foreground_turn',
      turnId: deps.turnId,
    },
  })

  let launch
  try {
    const launchInput: ChildTaskLaunchInput = {
      parentContext,
      taskSpec: {
        objective: input.objective,
        profileId: agentProfile,
        tools: input.suggestedTools,
        parentSessionId: deps.sessionId,
        parentTurnId: deps.turnId,
        launchMode: 'foreground',
        maxIterations: CHILD_MAX_ITERATIONS,
        timeoutMs: remainingMs,
      },
      depth: resolveChildDepth(deps),
      launchesInParentTurn: countLaunchesForTurn(deps),
      requestedTools: input.suggestedTools,
      parentRunId: deps.turnId,
      rootRunId: deps.turnId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
    }
    launch = runtime.launchTask(launchInput)
  } catch (error) {
    // Preserve the typed policy/runtime code (SUBAGENT_* / CHILD_TASK_*) so
    // callers can distinguish limit violations from generic launch failures.
    const terminal = toChildTaskTerminalError(error, {
      code:
        error instanceof ChildTaskPolicyError || error instanceof ChildTaskRuntimeError
          ? error.code
          : 'CHILD_TASK_LAUNCH_FAILED',
      recoverable: true,
      phase: 'launch',
    })
    return createErrorResult(terminal.code, terminal.message, terminal.recoverable, 'Failed to launch subagent task.', {
      runtimeActionIds: [runtimeAction.actionId],
    })
  }

  const taskId = launch.taskId
  const childSessionId = launch.childSessionId
  const subagentRunId = launch.subagentRunId

  const wait = await waitForChildWithBudget(runtime, subagentRunId, remainingMs, deps.signal)

  if (wait.outcome === 'timeout') {
    return createErrorResult(
      CHILD_TASK_TIMEOUT,
      `Subagent task ${taskId} exceeded the parent turn's remaining budget (${remainingMs}ms)`,
      true,
      'Subagent task timed out.',
      { runtimeActionIds: [runtimeAction.actionId] },
    )
  }

  if (wait.outcome === 'aborted') {
    return createErrorResult('CANCELLED', 'Subagent task was cancelled', true, 'Subagent task cancelled.', {
      runtimeActionIds: [runtimeAction.actionId],
    })
  }

  const result = wait.result

  if (result.status === 'cancelled') {
    return createErrorResult('CANCELLED', 'Subagent task was cancelled', true, 'Subagent task cancelled.', {
      runtimeActionIds: [runtimeAction.actionId],
    })
  }

  if (result.status === 'completed') {
    // Preserve the public tool result (bounded, sanitized) plus child metadata.
    const preserved = { status: 'completed', response: result.response }
    const policy = applyBoundedResultPolicy(preserved)

    let resultRef: string | undefined
    if (policy.mode === 'ref' && deps.toolResultStore) {
      const processed = processToolOutput(deps.toolResultStore, subagentRunId, preserved, {
        toolName: LAUNCH_SUBAGENT_TOOL_ID,
        userId: deps.userId,
        sessionId: deps.sessionId,
      })
      resultRef = processed.resultRef?.resultId
    }

    const data: ForegroundChildTaskData = {
      runtimeActionId: runtimeAction.actionId,
      agentType,
      agentProfile,
      dispatchResult: {
        requestId: deps.turnId,
        actionId: runtimeAction.actionId,
        status: 'completed',
        targetRuntime: 'subagent_runtime',
        result: {
          status: 'completed',
          summary: policy.summary,
          sizeBytes: policy.sizeBytes,
          taskId,
          childSessionId,
          subagentRunId,
          ...(resultRef ? { resultRef } : {}),
        },
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      taskId,
      childSessionId,
      subagentRunId,
    }

    return createSuccessResult(data, policy.summary, {
      runtimeActionIds: [runtimeAction.actionId],
    })
  }

  // Terminal failure: typed safe {code, message, recoverable, phase?} only —
  // never the raw error object, stack or child internals.
  const terminal = toChildTaskTerminalError(result.error?.message ?? 'Subagent task failed', {
    code: result.error?.code ?? 'CHILD_TASK_ERROR',
    recoverable: result.status === 'failed',
    phase: 'run',
  })
  return createErrorResult(terminal.code, terminal.message, terminal.recoverable, 'Subagent task failed.', {
    runtimeActionIds: [runtimeAction.actionId],
  })
}

type ChildWaitOutcome =
  | { outcome: 'completed'; result: SubagentResult }
  | { outcome: 'timeout' }
  | { outcome: 'aborted' }

// ---------------------------------------------------------------------------
// Unified runtime background launch (Todo 9/10)
// ---------------------------------------------------------------------------

/**
 * Enqueue a durable background child launch and return BEFORE completion.
 *
 * The full task spec (with `launchMode: 'background'`) is persisted by the
 * background runtime; the worker later creates the child session + a NEW
 * subagent_runs attempt, links them and executes the child, persisting an
 * exactly-once completion/failure notification for a later parent turn.
 *
 * When a `taskId` is supplied it is validated against the child runtime FIRST
 * (unknown/foreign fail with a typed code before anything is enqueued) and
 * carried as linkage metadata.
 */
async function handleBackgroundChildLaunch(
  deps: LaunchSubagentDeps,
  input: LaunchSubagentInput,
  identity: { agentType: string; agentProfile: string },
  parentContext: ContextBundle,
): Promise<ForegroundToolResult<LaunchSubagentData>> {
  const backgroundRuntime = deps.backgroundRuntime!
  const childRuntime = deps.childSessionTaskRuntime!
  const { agentType, agentProfile } = identity

  const runtimeAction = buildLaunchSubagentAction({
    agentType,
    agentProfile,
    taskSpec: {
      objective: input.objective,
      agentType: agentProfile,
      tools: input.suggestedTools,
    },
    userId: deps.userId,
    sessionId: deps.sessionId,
    parentContext,
    sourceRef: {
      sourceType: 'foreground_turn',
      turnId: deps.turnId,
    },
  })

  let taskId: string | undefined
  if (input.taskId) {
    const child = childRuntime.getChildSession(input.taskId)
    if (!child) {
      return createErrorResult(
        'CHILD_TASK_NOT_FOUND',
        `No task found for taskId "${input.taskId}"`,
        true,
        'Unknown task.',
        { runtimeActionIds: [runtimeAction.actionId] },
      )
    }
    if (child.userId !== deps.userId) {
      return createErrorResult(
        'CHILD_TASK_FOREIGN',
        `taskId "${input.taskId}" belongs to another user`,
        false,
        "Cannot resume another user's task.",
        { runtimeActionIds: [runtimeAction.actionId] },
      )
    }
    taskId = child.sessionId
  }

  const taskSpec: ChildTaskSpec = {
    objective: input.objective,
    profileId: agentProfile,
    tools: input.suggestedTools,
    parentSessionId: deps.sessionId,
    parentTurnId: deps.turnId,
    launchMode: 'background',
    maxIterations: CHILD_MAX_ITERATIONS,
    timeoutMs: deps.childTaskRemainingTimeoutMs ?? DEFAULT_FOREGROUND_CHILD_WAIT_MS,
    ...(taskId ? { taskId } : {}),
  }

  const backgroundRunId = backgroundRuntime.enqueueBackgroundRun({
    userId: deps.userId,
    sessionId: deps.sessionId,
    agentType,
    agentProfile,
    taskSpec,
    launchSource: CHILD_TASK_LAUNCH_SOURCE,
    ...(taskId ? { taskId, childSessionId: taskId } : {}),
  })

  const data: BackgroundChildTaskData = {
    runtimeActionId: runtimeAction.actionId,
    agentType,
    agentProfile,
    backgroundRunId,
    status: 'queued',
    ...(taskId ? { taskId } : {}),
    dispatchResult: {
      requestId: deps.turnId,
      actionId: runtimeAction.actionId,
      status: 'completed',
      targetRuntime: 'subagent_runtime',
      result: {
        backgroundRunId,
        status: 'queued',
        ...(taskId ? { taskId } : {}),
      },
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
  }

  return createSuccessResult(data, 'Subagent launched in the background.', {
    runtimeActionIds: [runtimeAction.actionId],
  })
}

/**
 * Resolve the depth of the CHILD being launched: the parent session's
 * `subagentDepth` plus one (a foreground parent at depth 0 produces a
 * depth-1 child). Falls back to 1 when no store is wired.
 */
function resolveChildDepth(deps: LaunchSubagentDeps): number {
  if (!deps.sessionStore) return 1
  return (deps.sessionStore.getById(deps.sessionId)?.subagentDepth ?? 0) + 1
}

/**
 * Count child launches already made in this parent turn — every run attempt
 * created by launchTask is stamped with `parentRunId = turnId`, so the count
 * is exact per turn (resumes included).
 */
function countLaunchesForTurn(deps: LaunchSubagentDeps): number {
  if (!deps.subagentRunStore) return 0
  return deps.subagentRunStore.query({ userId: deps.userId, parentRunId: deps.turnId }).length
}

/**
 * Wait for the child attempt with a hard budget. On budget expiry OR external
 * abort, cancelRun fires so the live child kernel is aborted (no orphan) and a
 * late terminal can never overwrite the cancelled run.
 */
async function waitForChildWithBudget(
  runtime: ChildSessionTaskRuntime,
  subagentRunId: string,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<ChildWaitOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const settle = (outcome: ChildWaitOutcome): void => {
      if (settled) return
      settled = true
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }

    const cancel = (): void => {
      try {
        runtime.cancelRun(subagentRunId)
      } catch {
        // cancelRun is idempotent; an unknown run simply has nothing to cancel.
      }
    }

    const onAbort = (): void => {
      cancel()
      settle({ outcome: 'aborted' })
    }

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    timeoutId = setTimeout(
      () => {
        cancel()
        settle({ outcome: 'timeout' })
      },
      Math.max(0, budgetMs),
    )

    void runtime.executeRun(subagentRunId, signal).then(
      (result) => settle({ outcome: 'completed', result }),
      () => settle({ outcome: 'timeout' }),
    )
  })
}
