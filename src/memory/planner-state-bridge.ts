import type { PlannerRunState, PlannerStatePatch } from '../planner/types.js';
import type { SessionMemoryPatch } from './types.js';

/**
 * Structured patch data for PlannerStatePatch.
 * Each patchType has a specific shape to replace the old Record<string, unknown>.
 */
export type PlannerStatePatchData =
  | {
      patchType: 'state_transition';
      from: PlannerRunState | null;
      to: PlannerRunState;
      reason?: string;
    }
  | {
      patchType: 'plan_update';
      planId: string;
      fromVersion: number;
      toVersion: number;
      planSummary?: string;
    }
  | {
      patchType: 'execution_ref_update';
      refId: string;
      refType: string;
      status: string;
    }
  | {
      patchType: 'checkpoint_update';
      checkpointKeys: string[];
    };

/**
 * Pure function that maps a PlannerStatePatch to a SessionMemoryPatch.
 * This is the bridge between planner state updates and session memory.
 */
export function plannerStateToSessionPatch(patch: PlannerStatePatch): SessionMemoryPatch {
  const { patchData } = patch;

  switch (patchData.patchType) {
    case 'state_transition':
      return {
        summary: `[state_transition] ${patchData.from ?? 'none'} → ${patchData.to}`,
        structuredState: {
          lastPlannerStateTransition: {
            from: patchData.from,
            to: patchData.to,
            reason: patchData.reason,
          },
        },
      };

    case 'plan_update':
      return {
        structuredState: {
          lastPlanUpdate: {
            planId: patchData.planId,
            fromVersion: patchData.fromVersion,
            toVersion: patchData.toVersion,
            planSummary: patchData.planSummary,
          },
        },
      };

    case 'execution_ref_update':
      return {
        structuredState: {
          lastExecutionRefUpdate: {
            refId: patchData.refId,
            refType: patchData.refType,
            status: patchData.status,
          },
        },
      };

    case 'checkpoint_update':
      return {
        structuredState: {
          lastCheckpointUpdate: patchData.checkpointKeys,
        },
      };
  }
}
