import type { PlannerStatePatch, PlannerStatePatchData } from '../planner/types.js';
import type { SessionMemoryPatch } from './types.js';

export type { PlannerStatePatchData };

export interface PlannerStateBridgeResult {
  updates: SessionMemoryPatch;
  warnings: string[];
}

export function plannerStateToSessionPatch(patch: PlannerStatePatch): PlannerStateBridgeResult {
  const { patchData } = patch;
  const warnings: string[] = [];

  switch (patchData.patchType) {
    case 'state_transition': {
      if (!patchData.to) {
        warnings.push('state_transition missing "to" field — skipping state update');
      }
      return {
        updates: {
          summary: `[state_transition] ${patchData.from ?? 'none'} → ${patchData.to}`,
          structuredState: {
            lastPlannerStateTransition: {
              from: patchData.from,
              to: patchData.to,
              reason: patchData.reason,
            },
          },
        },
        warnings,
      };
    }

    case 'plan_update': {
      if (!patchData.planId) {
        warnings.push('plan_update missing "planId" — partial patch applied');
      }
      return {
        updates: {
          structuredState: {
            lastPlanUpdate: {
              planId: patchData.planId,
              fromVersion: patchData.fromVersion,
              toVersion: patchData.toVersion,
              planSummary: patchData.planSummary,
            },
          },
        },
        warnings,
      };
    }

    case 'execution_ref_update': {
      if (!patchData.refId) {
        warnings.push('execution_ref_update missing "refId" — partial patch applied');
      }
      return {
        updates: {
          structuredState: {
            lastExecutionRefUpdate: {
              refId: patchData.refId,
              refType: patchData.refType,
              status: patchData.status,
            },
          },
        },
        warnings,
      };
    }

    case 'checkpoint_update': {
      return {
        updates: {
          structuredState: {
            lastCheckpointUpdate: patchData.checkpointKeys,
          },
        },
        warnings,
      };
    }
  }
}
