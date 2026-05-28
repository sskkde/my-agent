import type { ForegroundTurnInput, ForegroundTurnResult } from './foreground-runner-types.js';
import type { ForegroundAgent } from './foreground-agent.js';
import type { AgentKernel } from '../kernel/agent-kernel.js';
import type { RuntimeDispatcher } from '../dispatcher/types.js';
import type { PlannerRuntime } from '../planner/planner-runtime.js';
import type { LLMAdapter } from '../llm/adapter.js';

export interface ForegroundKernelRunnerDeps {
  foregroundAgent: ForegroundAgent;
  agentKernel: AgentKernel;
  runtimeDispatcher: RuntimeDispatcher;
  plannerRuntime: PlannerRuntime;
  llmAdapter: LLMAdapter;
}

export interface ForegroundKernelRunner {
  runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult>;
}

export class ForegroundKernelRunnerImpl implements ForegroundKernelRunner {
  constructor(_deps: ForegroundKernelRunnerDeps) {
    // Stub - deps will be used in Wave 2
  }

  async runTurn(_input: ForegroundTurnInput): Promise<ForegroundTurnResult> {
    // Stub - Wave 2 will implement orchestration logic
    return {
      status: 'completed',
      finalResponse: 'Stub response - ForegroundKernelRunner not yet implemented',
      decisionTrace: {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Stub - Wave 2',
      },
    };
  }
}

export function createForegroundKernelRunner(deps: ForegroundKernelRunnerDeps): ForegroundKernelRunner {
  return new ForegroundKernelRunnerImpl(deps);
}
