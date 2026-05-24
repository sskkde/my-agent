import { describe, it, expect } from 'vitest';
import { plannerStateToSessionPatch } from '../../../src/memory/planner-state-bridge.js';
import type { PlannerStatePatch, PlannerStatePatchData } from '../../../src/planner/types.js';

function makePatch(patchData: PlannerStatePatchData): PlannerStatePatch {
  return {
    plannerRunId: 'pl_run_test',
    patchType: patchData.patchType,
    patchData,
    createdAt: new Date().toISOString(),
  };
}

describe('plannerStateToSessionPatch', () => {
  describe('state_transition', () => {
    it('maps state_transition with from=null to SessionMemoryPatch', () => {
      const patch = makePatch({
        patchType: 'state_transition',
        from: null,
        to: 'initializing',
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.updates.summary).toBe('[state_transition] none → initializing');
      expect(result.updates.structuredState).toEqual({
        lastPlannerStateTransition: {
          from: null,
          to: 'initializing',
          reason: undefined,
        },
      });
      expect(result.warnings).toEqual([]);
    });

    it('maps state_transition with from state and reason', () => {
      const patch = makePatch({
        patchType: 'state_transition',
        from: 'planning',
        to: 'waiting_for_approval',
        reason: 'plan requires approval',
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.updates.summary).toBe('[state_transition] planning → waiting_for_approval');
      expect(result.updates.structuredState).toEqual({
        lastPlannerStateTransition: {
          from: 'planning',
          to: 'waiting_for_approval',
          reason: 'plan requires approval',
        },
      });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('plan_update', () => {
    it('maps plan_update to SessionMemoryPatch', () => {
      const patch = makePatch({
        patchType: 'plan_update',
        planId: 'plan_abc',
        fromVersion: 1,
        toVersion: 2,
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.updates.structuredState).toEqual({
        lastPlanUpdate: {
          planId: 'plan_abc',
          fromVersion: 1,
          toVersion: 2,
          planSummary: undefined,
        },
      });
      expect(result.updates.summary).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    it('maps plan_update with planSummary', () => {
      const patch = makePatch({
        patchType: 'plan_update',
        planId: 'plan_abc',
        fromVersion: 2,
        toVersion: 3,
        planSummary: 'Added step 4 for error handling',
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.updates.structuredState).toEqual({
        lastPlanUpdate: {
          planId: 'plan_abc',
          fromVersion: 2,
          toVersion: 3,
          planSummary: 'Added step 4 for error handling',
        },
      });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('execution_ref_update', () => {
    it('maps execution_ref_update to SessionMemoryPatch', () => {
      const patch = makePatch({
        patchType: 'execution_ref_update',
        refId: 'bg_run_001',
        refType: 'background_run',
        status: 'running',
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.updates.structuredState).toEqual({
        lastExecutionRefUpdate: {
          refId: 'bg_run_001',
          refType: 'background_run',
          status: 'running',
        },
      });
      expect(result.updates.summary).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });
  });

  describe('checkpoint_update', () => {
    it('maps checkpoint_update to SessionMemoryPatch', () => {
      const patch = makePatch({
        patchType: 'checkpoint_update',
        checkpointKeys: ['step', 'objective', 'activeExecutionRefs'],
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.updates.structuredState).toEqual({
        lastCheckpointUpdate: ['step', 'objective', 'activeExecutionRefs'],
      });
      expect(result.updates.summary).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    it('maps checkpoint_update with empty keys', () => {
      const patch = makePatch({
        patchType: 'checkpoint_update',
        checkpointKeys: [],
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.updates.structuredState).toEqual({
        lastCheckpointUpdate: [],
      });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('graceful degradation', () => {
    it('warns on state_transition with empty to field', () => {
      const patch = makePatch({
        patchType: 'state_transition',
        from: 'planning',
        to: '' as any,
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('missing');
      expect(result.updates).toBeDefined();
    });

    it('warns on plan_update with empty planId', () => {
      const patch = makePatch({
        patchType: 'plan_update',
        planId: '',
        fromVersion: 1,
        toVersion: 2,
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('missing');
      expect(result.updates).toBeDefined();
    });

    it('warns on execution_ref_update with empty refId', () => {
      const patch = makePatch({
        patchType: 'execution_ref_update',
        refId: '',
        refType: 'background_run',
        status: 'running',
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('missing');
      expect(result.updates).toBeDefined();
    });

    it('returns empty warnings for fully populated patches', () => {
      const patch = makePatch({
        patchType: 'plan_update',
        planId: 'plan_abc',
        fromVersion: 1,
        toVersion: 2,
        planSummary: 'test',
      });

      const result = plannerStateToSessionPatch(patch);

      expect(result.warnings).toEqual([]);
      expect(result.updates.structuredState).toBeDefined();
    });
  });
});

describe('PlannerStatePatchData discriminated union', () => {
  it('state_transition requires from and to', () => {
    const data: PlannerStatePatchData = {
      patchType: 'state_transition',
      from: null,
      to: 'planning',
    };
    expect(data.patchType).toBe('state_transition');
  });

  it('plan_update requires planId and versions', () => {
    const data: PlannerStatePatchData = {
      patchType: 'plan_update',
      planId: 'plan_1',
      fromVersion: 1,
      toVersion: 2,
    };
    expect(data.patchType).toBe('plan_update');
  });

  it('execution_ref_update requires refId, refType, status', () => {
    const data: PlannerStatePatchData = {
      patchType: 'execution_ref_update',
      refId: 'ref_1',
      refType: 'tool_execution',
      status: 'completed',
    };
    expect(data.patchType).toBe('execution_ref_update');
  });

  it('checkpoint_update requires checkpointKeys', () => {
    const data: PlannerStatePatchData = {
      patchType: 'checkpoint_update',
      checkpointKeys: ['step'],
    };
    expect(data.patchType).toBe('checkpoint_update');
  });
});
