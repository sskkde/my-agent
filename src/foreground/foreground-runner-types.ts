/**
 * Foreground Kernel Runner Types
 * Type definitions for the ForegroundKernelRunner architecture
 */

import type { ForegroundDecision, ForegroundSessionState } from './types.js';
import type { HydratedSessionState } from '../gateway/types.js';
import type { AgentConfig } from '../storage/agent-config-store.js';
import type { KernelRunResult } from '../kernel/types.js';
import type { TurnTranscript } from '../storage/transcript-store.js';

/**
 * Status of a foreground turn execution
 */
export type ForegroundTurnStatus = 'completed' | 'failed';

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
  /** Kernel result if kernel was invoked */
  kernelResult?: KernelRunResult;
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
  /** Kernel result if kernel was invoked */
  kernelResult?: KernelRunResult;
  /** Error details if execution failed */
  error?: { code: string; message: string };
}
