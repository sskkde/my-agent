import type {
  SubagentRun,
  SubagentResult,
  SubagentConfig,
  LaunchSubagentInput,
  SubagentRuntime,
} from './types.js';
import type { KernelRunResult } from '../kernel/types.js';

export class SubagentRuntimeImpl implements SubagentRuntime {
  private config: SubagentConfig;
  private runs = new Map<string, SubagentRun>();

  constructor(config: SubagentConfig) {
    this.config = config;
  }

  launchSubagent(input: LaunchSubagentInput): SubagentRun {
    const subagentRunId = this.generateId('subagent');
    const now = new Date().toISOString();

    const parentRunId = input.parentRunId ?? input.parentContext.runId;
    const rootRunId = input.rootRunId ?? parentRunId;

    const contextBundle = this.config.contextManager.createIsolatedContext({
      parentContext: input.parentContext,
      taskSpec: input.taskSpec,
      subagentRunId,
    });

    const run: SubagentRun = {
      subagentRunId,
      taskSpec: input.taskSpec,
      parentRunId,
      rootRunId,
      status: 'queued',
      contextBundle,
      createdAt: now,
      isCancelled: false,
    };

    this.runs.set(subagentRunId, run);

    return run;
  }

  async executeSubagent(subagentRunId: string): Promise<SubagentResult> {
    const run = this.runs.get(subagentRunId);
    if (!run) {
      throw new Error(`Subagent run not found: ${subagentRunId}`);
    }

    if (run.isCancelled) {
      const cancelledResult = this.createCancelledResult();
      run.result = cancelledResult;
      run.status = 'cancelled';
      run.completedAt = new Date().toISOString();
      return cancelledResult;
    }

    run.status = 'running';
    run.startedAt = new Date().toISOString();

    const maxIterations = run.taskSpec.maxIterations ?? this.config.defaultMaxIterations ?? 10;
    const timeoutMs = run.taskSpec.timeoutMs ?? this.config.defaultTimeoutMs ?? 60000;

    try {
      const kernelResult = await this.config.kernelAdapter.execute({
        contextBundle: run.contextBundle,
        maxIterations,
        timeoutMs,
        onCancel: () => run.isCancelled,
      });

      const result = this.mapKernelResultToSubagentResult(kernelResult);
      run.result = result;
      run.status = result.status === 'completed' ? 'completed' : 'failed';
      run.completedAt = new Date().toISOString();

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedResult: SubagentResult = {
        status: 'failed',
        response: undefined,
        toolCalls: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: errorMessage,
        },
        iterationsUsed: 0,
        startedAt: run.startedAt,
        completedAt: new Date().toISOString(),
      };

      run.result = failedResult;
      run.status = 'failed';
      run.completedAt = new Date().toISOString();

      return failedResult;
    }
  }

  cancelSubagent(subagentRunId: string): SubagentResult {
    const run = this.runs.get(subagentRunId);
    if (!run) {
      throw new Error(`Subagent run not found: ${subagentRunId}`);
    }

    run.isCancelled = true;

    const cancelledResult = this.createCancelledResult();
    run.result = cancelledResult;
    run.status = 'cancelled';
    run.completedAt = new Date().toISOString();

    return cancelledResult;
  }

  getSubagentResult(subagentRunId: string): SubagentResult | undefined {
    const run = this.runs.get(subagentRunId);
    return run?.result;
  }

  getSubagentRun(subagentRunId: string): SubagentRun | undefined {
    return this.runs.get(subagentRunId);
  }

  private mapKernelResultToSubagentResult(kernelResult: KernelRunResult): SubagentResult {
    const status = this.mapKernelStatusToSubagentStatus(kernelResult.finalStatus);

    return {
      status,
      response: kernelResult.finalResponse,
      toolCalls: kernelResult.toolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        params: tc.params,
      })),
      error: kernelResult.error,
      iterationsUsed: kernelResult.iterationsUsed,
    };
  }

  private mapKernelStatusToSubagentStatus(
    kernelStatus: KernelRunResult['finalStatus']
  ): SubagentResult['status'] {
    switch (kernelStatus) {
      case 'completed':
        return 'completed';
      case 'failed':
      case 'timeout':
      case 'max_iterations_reached':
        return 'failed';
      default:
        return 'failed';
    }
  }

  private createCancelledResult(): SubagentResult {
    const now = new Date().toISOString();
    return {
      status: 'cancelled',
      response: undefined,
      toolCalls: [],
      error: {
        code: 'CANCELLED',
        message: 'Subagent execution was cancelled',
      },
      iterationsUsed: 0,
      completedAt: now,
    };
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export function createSubagentRuntime(config: SubagentConfig): SubagentRuntime {
  return new SubagentRuntimeImpl(config);
}
