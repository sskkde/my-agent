/**
 * Foreground Tool Runtime - shared runtime-deps type, result mapper, and turn-identity resolver.
 *
 * Pure module: no launch/spawn/approval business logic. Consumed by registerAllForegroundTools
 * (A2) to wire real handlers behind the six foreground orchestration tools.
 *
 * @module foreground/tools/foreground-tool-runtime
 */

import type { RuntimeDispatcher } from '../../dispatcher/types.js'
import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import type { SubagentRunStore } from '../../storage/subagent-run-store.js'
import type { ApprovalStore } from '../../storage/approval-store.js'
import type { SessionStore } from '../../storage/session-store.js'
import type { AgentProfileRegistry } from '../../taxonomy/agent-profile-registry.js'
import type { ForegroundToolResult } from './foreground-tool-result.js'
import type { ToolExecutionContext, ToolExecutionResult } from '../../tools/types.js'
import type { ChildSessionTaskRuntime } from '../../subagents/child-session-task-runtime.js'
import type { BackgroundRuntime } from '../../subagents/background-runtime.js'
import type { BackgroundRunStore } from '../../storage/background-run-store.js'
import type { ToolResultStore } from '../../storage/tool-result-store.js'

// ---------------------------------------------------------------------------
// 1. Runtime deps - long-lived services closed over by foreground tool handlers
// ---------------------------------------------------------------------------

/**
 * Long-lived runtime services that foreground tool handlers close over.
 * Injected by `registerAllForegroundTools` (optional param) so real handlers
 * can dispatch RuntimeAction instances to target runtimes (subagent, planner, …)
 * and query stores / resolve agent profiles without importing connectors or
 * memory modules directly (import-boundaries enforced).
 */
export interface ForegroundToolRuntimeDeps {
  runtimeDispatcher: RuntimeDispatcher
  plannerRuntime: PlannerRuntime
  plannerRunStore: PlannerRunStore
  subagentRunStore: SubagentRunStore
  approvalStore: ApprovalStore
  profileRegistry: AgentProfileRegistry
  /**
   * Unified child-session runtime. When wired (Todo 8+), foreground subagent
   * launches run child execution under this runtime and WAIT within the parent
   * turn's remaining budget instead of the RuntimeDispatcher 30s default.
   */
  childSessionTaskRuntime?: ChildSessionTaskRuntime
  /** Store for persisting large child results by reference (>32KiB). */
  toolResultStore?: ToolResultStore
  /**
   * Remaining parent-turn budget (ms) for foreground child waits. Wired by the
   * composition root from the parent turn's remaining timeout budget.
   */
  childTaskRemainingTimeoutMs?: number
  /**
   * Todo 9 background machinery for `foreground_launch_subagent` launches with
   * `background=true`: enqueue + return immediately; the worker completes later.
   */
  backgroundRuntime?: BackgroundRuntime
  /** Store for looking up the background run linked to a planner run (resume/cancel linkage). */
  backgroundRunStore?: BackgroundRunStore
  /** Parent session store used to resolve child depth for policy enforcement. */
  sessionStore?: SessionStore
}

// ---------------------------------------------------------------------------
// 2. Result mapper - ForegroundToolResult<T> -> ToolExecutionResult
// ---------------------------------------------------------------------------

/**
 * Map a `ForegroundToolResult<T>` into the tool-plane `ToolExecutionResult`.
 *
 * Mapping (mirrors the reference pattern in foreground/tools/index.ts:128-136):
 * - `success`       ← result.success
 * - `data`          ← result.data (only when success)
 * - `error`         ← result.error (preserves code/message/recoverable exactly)
 * - `resultPreview` ← result.userVisibleSummary
 *
 * Left undefined (per spec): synthetic, status, contextDelta, resultRef,
 * structuredContent, events.
 */
export function mapForegroundToolResult<T = unknown>(result: ForegroundToolResult<T>): ToolExecutionResult {
  const mapped: ToolExecutionResult = {
    success: result.success,
    resultPreview: result.userVisibleSummary,
  }

  if (result.success) {
    mapped.data = result.data
  }

  if (result.error) {
    mapped.error = {
      code: result.error.code,
      message: result.error.message,
      recoverable: result.error.recoverable,
    }
  }

  return mapped
}

// ---------------------------------------------------------------------------
// 3. Turn-identity resolver - never throws, returns identity or error result
// ---------------------------------------------------------------------------

/** Resolved per-call identity sourced from a {@link ToolExecutionContext}. */
export interface TurnIdentity {
  userId: string
  sessionId: string
  turnId: string
}

/**
 * Resolve per-call identity (userId / sessionId / turnId) from a tool execution
 * context. Returns the identity on success, or an error `ToolExecutionResult`
 * when the session is missing - never throws.
 *
 * - `userId`    = context.userId
 * - `sessionId` = context.sessionId (missing -> SESSION_REQUIRED error result)
 * - `turnId`    = context.kernelRunId ?? context.toolCallId
 */
export function resolveTurnIdentity(context: ToolExecutionContext): TurnIdentity | { error: ToolExecutionResult } {
  const userId = context.userId
  const sessionId = context.sessionId

  if (!sessionId) {
    return {
      error: {
        success: false,
        error: {
          code: 'SESSION_REQUIRED',
          message: 'Foreground tool requires a session context',
          recoverable: true,
        },
        resultPreview: 'Session required for foreground tool execution',
      },
    }
  }

  const turnId = context.kernelRunId ?? context.toolCallId

  return { userId, sessionId, turnId }
}
