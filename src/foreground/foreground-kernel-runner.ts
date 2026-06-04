/**
 * Foreground Kernel Runner — DEPRECATED / HISTORICAL
 *
 * @deprecated This module has been replaced by foreground tools (Wave 2: T7–T12)
 * and the processor pipeline (T15). It is preserved **solely** for test fixtures
 * that validate backward-compatible behaviour.
 *
 * @historical The route-dispatch logic (`switch(decision.route)`, handler methods)
 * was the original main entry point for foreground turns. After tools and
 * processor cutover the production path flows through
 * `ForegroundAgent.runTurn()` → processor pipeline → foreground tools.
 *
 * @see src/foreground/tools/           — replacement tool implementations
 * @see src/processing/processor-orchestration.ts — replacement pipeline
 * @see src/foreground/foreground-agent.ts        — canonical runTurn() owner
 */

import type {
  ForegroundTurnInput,
  ForegroundTurnResult,
  RedactedKernelResult,
} from './foreground-runner-types.js';
import type { ForegroundDecision } from './types.js';
import type { KernelRunResult } from '../kernel/types.js';

// ---------------------------------------------------------------------------
// Deprecated interfaces — kept for type-compatibility with test fixtures
// ---------------------------------------------------------------------------

/** @deprecated No production code constructs these deps. Preserved for test fixtures. */
export interface ForegroundKernelRunnerDeps {
  foregroundAgent: import('./foreground-agent.js').ForegroundAgent;
  agentKernel: import('../kernel/agent-kernel.js').AgentKernel;
  runtimeDispatcher: import('../dispatcher/types.js').RuntimeDispatcher;
  plannerRuntime: import('../planner/planner-runtime.js').PlannerRuntime;
  llmAdapter: import('../llm/adapter.js').LLMAdapter;
  searchSubagent?: import('../search/search-subagent.js').SearchSubagent;
  agentConfig?: import('../storage/agent-config-store.js').AgentConfig;
  eventStore?: import('../storage/event-store.js').EventStore;
}

/** @deprecated Use `ForegroundAgent.runTurn()` via the processor pipeline. */
export interface ForegroundKernelRunner {
  runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult>;
}

// ---------------------------------------------------------------------------
// Deprecated implementation — returns a clear "removed" error
// ---------------------------------------------------------------------------

/**
 * @deprecated Preserved for test-fixture backward compatibility only.
 * The route-dispatch switch and handler methods have been removed.
 * Production code must use `ForegroundAgent.runTurn()` → processor pipeline.
 */
export class ForegroundKernelRunnerImpl implements ForegroundKernelRunner {
  private _deps: ForegroundKernelRunnerDeps;

  constructor(deps: ForegroundKernelRunnerDeps) {
    this._deps = deps;
  }

  /**
   * @deprecated This method is a historical stub. All route-dispatch logic
   * (switch(decision.route), handleDispatchTool, handleAnswerDirectly, etc.)
   * has been removed. Use the processor pipeline instead.
   */
  async runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult> {
    // Delegate to the ForegroundAgent.runTurn() if available, otherwise
    // return a clear "deprecated" error.  This keeps the thin wrapper
    // functional for legacy test fixtures that call `runner.runTurn()`.
    if (this._deps.foregroundAgent?.runTurn) {
      return this._deps.foregroundAgent.runTurn(input);
    }

    const fallbackDecision: ForegroundDecision = {
      route: 'answer_directly',
      requiresPlanner: false,
      reason: 'ForegroundKernelRunner.runTurn() is deprecated — no foreground agent available',
    };

    return {
      status: 'failed',
      finalResponse: '',
      decisionTrace: fallbackDecision,
      error: {
        code: 'DEPRECATED_RUNNER',
        message:
          'ForegroundKernelRunner.runTurn() has been removed. ' +
          'Use ForegroundAgent.runTurn() via the processor pipeline.',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Standalone utilities — re-exported / preserved for backward compatibility
// ---------------------------------------------------------------------------

/**
 * Build runtime summary from kernel execution result.
 *
 * Re-exported from the canonical location `tools/runtime-summary-helpers.ts`.
 * @deprecated Import from `src/foreground/tools/runtime-summary-helpers.js` instead.
 */
export { buildRuntimeSummary } from './tools/runtime-summary-helpers.js';

/**
 * Build a redacted kernel result for external exposure.
 *
 * Does NOT include transcript or tool params which could contain sensitive data.
 * @deprecated The processor pipeline handles redaction internally.
 */
export function buildRedactedKernelResult(
  kernelResult?: KernelRunResult,
): RedactedKernelResult | undefined {
  if (!kernelResult) return undefined;
  return {
    finalStatus: kernelResult.finalStatus,
    finalResponse: kernelResult.finalResponse,
    iterationsUsed: kernelResult.iterationsUsed,
    toolCallCount: kernelResult.toolCalls.length,
  };
}

// ---------------------------------------------------------------------------
// Factory — kept for test-fixture backward compatibility
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `createForegroundAgent()` and the processor pipeline instead.
 * Preserved solely for test fixtures that exercise the legacy runner path.
 */
export function createForegroundKernelRunner(
  deps: ForegroundKernelRunnerDeps,
): ForegroundKernelRunner {
  return new ForegroundKernelRunnerImpl(deps);
}
