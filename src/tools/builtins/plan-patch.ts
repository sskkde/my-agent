import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { PlanStore } from '../../storage/plan-store.js';

export interface PlanPatchParams {
  planId: string;
  patch: string;
  fromVersion: number;
  toVersion: number;
}

export interface PlanPatchResult {
  planId: string;
  currentVersion: number;
  updatedAt: string;
  [key: string]: unknown;
}

export function createPlanPatchTool(planStore: PlanStore): ToolDefinition {
  const handler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as PlanPatchParams;

    if (!typedParams.planId) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: planId',
          recoverable: true,
        },
      };
    }

    if (!typedParams.patch) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: patch',
          recoverable: true,
        },
      };
    }

    const existingPlan = planStore.getPlan(typedParams.planId);
    if (!existingPlan) {
      return {
        success: false,
        error: {
          code: 'PLAN_NOT_FOUND',
          message: `Plan ${typedParams.planId} not found`,
          recoverable: false,
        },
      };
    }

    try {
      const updated = planStore.applyPatch({
        planId: typedParams.planId,
        patch: typedParams.patch,
        fromVersion: typedParams.fromVersion,
        toVersion: typedParams.toVersion,
        createdAt: new Date().toISOString(),
      });

      const result: PlanPatchResult = {
        planId: updated.planId,
        currentVersion: updated.currentVersion,
        updatedAt: updated.updatedAt,
      };

      return {
        success: true,
        data: result,
        resultPreview: `Patched plan ${updated.planId} to version ${updated.currentVersion}`,
        structuredContent: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'PATCH_FAILED',
          message: `Failed to apply patch: ${errorMessage}`,
          recoverable: true,
        },
      };
    }
  };

  return {
    name: 'plan_patch',
    description: 'Apply a patch to an execution plan',
    category: 'write',
    sensitivity: 'high',
    schema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'ID of the plan to patch' },
        patch: { type: 'string', description: 'JSON string containing the patch data' },
        fromVersion: { type: 'number', description: 'Current version of the plan' },
        toVersion: { type: 'number', description: 'Target version after patch' },
      },
      required: ['planId', 'patch', 'fromVersion', 'toVersion'],
    },
    handler,
  };
}
