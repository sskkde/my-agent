import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';

export interface StatusQueryParams {
  targetId?: string;
}

export interface StatusQueryResult {
  activeWork: {
    plannerRuns: Array<{
      plannerRunId: string;
      status: string;
      objective?: string;
      progress?: string;
    }>;
    backgroundRuns: Array<{
      backgroundRunId: string;
      status: string;
      taskSummary?: string;
      progress?: string;
    }>;
    pendingApprovals: Array<{
      approvalId: string;
      status: string;
      summary?: string;
    }>;
  };
  timestamp: string;
  [key: string]: unknown;
}

export function createStatusQueryTool(): ToolDefinition {
  const handler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as StatusQueryParams;

    // Stub implementation - in real implementation, this would query ActiveWorkProjection
    // Task 27 implements the actual ActiveWorkProjection
    const result: StatusQueryResult = {
      activeWork: {
        plannerRuns: typedParams.targetId ? [{
          plannerRunId: typedParams.targetId,
          status: 'active',
          objective: 'Task in progress',
          progress: '50%',
        }] : [],
        backgroundRuns: [],
        pendingApprovals: [],
      },
      timestamp: new Date().toISOString(),
    };

    return {
      success: true,
      data: result,
      resultPreview: `Active work status: ${result.activeWork.plannerRuns.length} planner run(s), ${result.activeWork.backgroundRuns.length} background run(s), ${result.activeWork.pendingApprovals.length} pending approval(s)`,
      structuredContent: result,
    };
  };

  return {
    name: 'status.query',
    description: 'Query active work status for the current user or a specific run',
    category: 'read',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Optional specific run ID to query' },
      },
      required: [],
    },
    handler,
  };
}
