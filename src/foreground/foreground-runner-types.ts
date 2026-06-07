/**
 * Foreground Runner Types
 *
 * Processor-facing contract for foreground turns.
 * `ForegroundAgent.runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult>`
 * is the canonical entry point.
 *
 * @deprecated `ForegroundKernelRunner` has been removed (T17). The processor
 * pipeline calls `ForegroundAgent.runTurn()` directly. The runner types and
 * interfaces remain for backward compatibility with test fixtures.
 */

import type { ForegroundDecision, ForegroundSessionState } from './types.js'
import type { HydratedSessionState } from '../gateway/types.js'
import type { AgentConfig } from '../storage/agent-config-store.js'
import type { KernelRunResult, KernelRunStatus } from '../kernel/types.js'
import type { TurnTranscript } from '../storage/transcript-store.js'

/**
 * Status of a foreground turn execution
 */
export type ForegroundTurnStatus = 'completed' | 'failed'

/**
 * Redacted kernel result for external exposure
 * Does NOT include transcript or tool params which could contain sensitive data.
 */
export interface RedactedKernelResult {
  finalStatus: KernelRunStatus
  finalResponse?: string
  iterationsUsed: number
  toolCallCount: number
}

/**
 * Summary of a single tool call within a foreground turn.
 * Used by both `runtimeSummary.toolCallSummaries` and the top-level
 * `ForegroundTurnResult.toolCallSummaries` for direct access.
 */
export interface ToolCallSummary {
  toolCallId: string
  toolName: string
  status: 'completed' | 'failed' | 'skipped'
  summary?: string
}

/**
 * Input for a foreground turn execution.
 *
 * This is the processor-facing contract. `ForegroundAgent.runTurn()` accepts
 * this type as its sole argument.
 */
export interface ForegroundTurnInput {
  /** User ID */
  userId: string
  /** Session ID */
  sessionId: string
  /** Current turn ID */
  turnId: string
  /** User message text */
  message: string
  /** Timestamp of the message */
  timestamp: string
  /** Hydrated session state from gateway */
  hydratedState: HydratedSessionState
  /** Foreground session state */
  foregroundState: ForegroundSessionState
  /** Effective agent configuration (merged global + user override) */
  agentConfig?: AgentConfig
  /**
   * Agent ID for the foreground agent instance (e.g. 'foreground.default').
   * Used for agent-scoped configuration and kernel routing.
   */
  agentId?: string
  /**
   * Maximum iterations for kernel-backed tool loops.
   * If not set, the kernel default applies.
   */
  maxIterations?: number
  /**
   * Timeout in milliseconds for the entire turn.
   * If not set, the configured routing timeout applies.
   */
  timeoutMs?: number
}

/**
 * Result of a foreground turn execution.
 *
 * This is the canonical output type for `ForegroundAgent.runTurn()`.
 * Processors use this to build channel-neutral output.
 */
export interface ForegroundTurnResult {
  /** Execution status */
  status: ForegroundTurnStatus
  /** Final response to show the user */
  finalResponse: string
  /**
   * Decision trace for this turn.
   *
   * @deprecated The `decisionTrace` field references `ForegroundDecision` which
   * is a historical type. New code should use `status`, `finalResponse`, and
   * `toolCallSummaries` directly. The decision trace is preserved for backward
   * compatibility and diagnostic logging only.
   */
  decisionTrace: ForegroundDecision
  /** Redacted kernel result if kernel was invoked - does NOT contain transcript or params */
  kernelResult?: RedactedKernelResult
  /** Runtime summary for transcript */
  runtimeSummary?: TurnTranscript['runtimeSummary']
  /**
   * Direct access to tool call summaries for this turn.
   * Equivalent to `runtimeSummary?.toolCallSummaries` but always available
   * at the top level for convenience.
   */
  toolCallSummaries?: ToolCallSummary[]
  /** Error details if failed */
  error?: { code: string; message: string }
}

/**
 * Internal execution result capturing intermediate execution data
 * @internal
 */
export interface ForegroundExecutionResult {
  /** Decision route taken */
  route: string
  /** Final response string */
  finalResponse: string
  /** Runtime summary from execution */
  runtimeSummary?: TurnTranscript['runtimeSummary']
  /** Raw kernel result if kernel was invoked (for internal use only) */
  kernelResult?: KernelRunResult
  /** Error details if execution failed */
  error?: { code: string; message: string }
}
