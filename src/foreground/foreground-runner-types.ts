/**
 * Foreground Kernel Runner Types
 * Type definitions for the ForegroundKernelRunner architecture
 */

import type { ForegroundDecision, ForegroundSessionState } from './types.js';
import type { HydratedSessionState } from '../gateway/types.js';
import type { AgentConfig } from '../storage/agent-config-store.js';
import type { KernelRunResult, KernelRunStatus } from '../kernel/types.js';
import type { TurnTranscript } from '../storage/transcript-store.js';

/**
 * Status of a foreground turn execution
 */
export type ForegroundTurnStatus = 'completed' | 'failed';

/**
 * Redacted kernel result for external exposure
 * Does NOT include transcript or tool params which could contain sensitive data.
 */
export interface RedactedKernelResult {
  finalStatus: KernelRunStatus;
  finalResponse?: string;
  iterationsUsed: number;
  toolCallCount: number;
}

/**
 * Input for a foreground turn execution
 */
export interface ForegroundTurnInput {
  /** User ID */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** Current turn ID */
  turnId: string;
  /** User message text */
  message: string;
  /** Timestamp of the message */
  timestamp: string;
  /** Hydrated session state from gateway */
  hydratedState: HydratedSessionState;
  /** Foreground session state */
  foregroundState: ForegroundSessionState;
  /** Effective agent configuration (merged global + user override) */
  agentConfig?: AgentConfig;
}

/**
 * Result of a foreground turn execution
 */
export interface ForegroundTurnResult {
  /** Execution status */
  status: ForegroundTurnStatus;
  /** Final response to show the user */
  finalResponse: string;
  /** Decision trace for this turn */
  decisionTrace: ForegroundDecision;
  /** Redacted kernel result if kernel was invoked - does NOT contain transcript or params */
  kernelResult?: RedactedKernelResult;
  /** Runtime summary for transcript */
  runtimeSummary?: TurnTranscript['runtimeSummary'];
  /** Error details if failed */
  error?: { code: string; message: string };
}

/**
 * Internal execution result capturing intermediate execution data
 * @internal
 */
export interface ForegroundExecutionResult {
  /** Decision route taken */
  route: string;
  /** Final response string */
  finalResponse: string;
  /** Runtime summary from execution */
  runtimeSummary?: TurnTranscript['runtimeSummary'];
  /** Raw kernel result if kernel was invoked (for internal use only) */
  kernelResult?: KernelRunResult;
  /** Error details if execution failed */
  error?: { code: string; message: string };
}
