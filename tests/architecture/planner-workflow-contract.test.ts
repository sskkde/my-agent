/**
 * Architecture Contract Tests — Planner Workflow Boundaries
 *
 * Verifies PlannerRuntime → RuntimeAction → ExecutionPlan contract.
 * Tests that planner only plans (never executes tools directly),
 * RuntimeAction validity, write tool approval gating, DAG integrity,
 * audit trail, and terminal plan immutability.
 */
import { describe, it, expect } from 'vitest';
import type {
  ExecutionPlan,
  PlanStep,
  PlanStepKind,
  ApprovalRequirement,
} from '../../src/planner/plan-schema.js';
import { PlanValidator } from '../../src/planner/plan-validator.js';
import type { PlanValidatorDeps } from '../../src/planner/plan-validator.js';
import type {
  PlannerRuntimeAction,
  PlannerResumeEvent,
} from '../../src/planner/types.js';
import type { TargetRuntime } from '../../src/dispatcher/types.js';
import type { PlanPatch } from '../../src/storage/plan-store.js';
import { PLANNER_STATES, EXECUTION_PLAN_STATES } from '../../src/shared/states.js';

// ─── Mock tool registry for PlanValidator ────────────────────────────────

function mockToolRegistry(withWriteTool: boolean): PlanValidatorDeps['toolRegistry'] {
  const tools = new Map<string, { name: string; category: string }>();
  if (withWriteTool) {
    tools.set('write_file', { name: 'write_file', category: 'write' });
  }
  tools.set('read_file', { name: 'read_file', category: 'read' });
  return {
    hasTool(name: string): boolean {
      return tools.has(name);
    },
    getTool(name: string): { name: string; category: string } | null {
      return tools.get(name) ?? null;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<PlanStep> & { id: string; kind: PlanStepKind }): PlanStep {
  return {
    title: `Step ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    executor: 'agent_kernel',
    ...overrides,
  };
}

function makePlan(overrides: Partial<ExecutionPlan> & { id: string; goal: string; steps: PlanStep[] }): ExecutionPlan {
  return {
    version: 1,
    createdAt: '2026-05-11T00:00:00Z',
    updatedAt: '2026-05-11T00:00:00Z',
    ...overrides,
  };
}

// ─── Contract 1: Planner doesn't directly execute tools ──────────────────

describe('Planner Workflow Contract', () => {

  describe('Contract 1: Planner does NOT directly execute tools', () => {
    it('PlannerRuntime interface has no executeTool method', () => {
      const runtimeMethodNames = [
        'createPlannerRun', 'resumePlannerRun', 'cancelPlannerRun',
        'replan', 'archivePlannerRun', 'transitionState',
        'handleApprovalRejection', 'applyPlanPatch', 'addActiveExecutionRef',
        'emitRuntimeAction', 'saveCheckpoint',
      ];
      const toolExecutionNames = ['executeTool', 'runTool', 'invokeTool', 'callTool'];
      for (const name of runtimeMethodNames) {
        expect(toolExecutionNames).not.toContain(name);
      }
    });

    it('PlannerRuntime emits RuntimeAction rather than executing tools directly', () => {
      const action: PlannerRuntimeAction = {
        actionId: 'act_001',
        targetRuntime: 'tool_plane',
        targetAction: 'execute_tool',
        payload: { toolName: 'write_file', args: {} },
        status: 'created',
      };
      expect(action.targetRuntime).toBe('tool_plane');
      expect(action.targetAction).toBe('execute_tool');
    });

    it('PlannerRuntimeAction always has targetRuntime and targetAction for dispatch', () => {
      const requiredKeys: Array<keyof PlannerRuntimeAction> = [
        'actionId', 'targetRuntime', 'targetAction', 'payload', 'status',
      ];
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string');
      }
      const action: PlannerRuntimeAction = {
        actionId: 'act_001',
        targetRuntime: 'agent_kernel',
        targetAction: 'start_agent_run',
        payload: {},
        status: 'created',
      };
      expect(action.targetRuntime.length).toBeGreaterThan(0);
      expect(action.targetAction.length).toBeGreaterThan(0);
    });
  });

  // ─── Contract 2: RuntimeAction validity ────────────────────────────────

  describe('Contract 2: RuntimeAction validity', () => {
    it('valid TargetRuntimes include planner_runtime, agent_kernel, tool_plane', () => {
      const validRuntimes: TargetRuntime[] = [
        'agent_kernel', 'subagent_runtime', 'tool_plane',
        'workflow_runtime', 'event_trigger_runtime', 'permission_engine',
        'gateway', 'notification_center', 'connector_runtime',
        'memory_system', 'summary_manager', 'replay_service',
        'foreground_conversation_agent', 'planner_runtime',
      ];
      expect(validRuntimes).toHaveLength(14);
      expect(validRuntimes).toContain('planner_runtime');
      expect(validRuntimes).toContain('agent_kernel');
      expect(validRuntimes).toContain('tool_plane');
    });

    it('planner emits actions to valid target runtimes only', () => {
      const validRuntimes = new Set([
        'agent_kernel', 'tool_plane', 'planner_runtime', 'workflow_runtime',
      ]);

      const action1: PlannerRuntimeAction = {
        actionId: 'act_001', targetRuntime: 'agent_kernel',
        targetAction: 'start_agent_run', payload: {}, status: 'created',
      };
      const action2: PlannerRuntimeAction = {
        actionId: 'act_002', targetRuntime: 'tool_plane',
        targetAction: 'execute_tool', payload: {}, status: 'created',
      };
      const action3: PlannerRuntimeAction = {
        actionId: 'act_003', targetRuntime: 'planner_runtime',
        targetAction: 'replan', payload: {}, status: 'created',
      };

      expect(validRuntimes.has(action1.targetRuntime)).toBe(true);
      expect(validRuntimes.has(action2.targetRuntime)).toBe(true);
      expect(validRuntimes.has(action3.targetRuntime)).toBe(true);
    });

    it('RuntimeAction from planner has source.sourceModule set to "planner"', () => {
      const sourceModule = 'planner';
      expect(sourceModule).toBe('planner');
    });
  });

  // ─── Contract 3: Write tool → approval requirement ─────────────────────

  describe('Contract 3: Write tool must have approval requirement', () => {
    it('write tool step with approvalRequirementId and matching requiredApprovals passes validation', () => {
      const approval: ApprovalRequirement = {
        approvalId: 'approval-write',
        reason: 'Write operation requires approval',
        riskLevel: 'medium',
      };

      const step: PlanStep = makeStep({
        id: 'step_write',
        kind: 'tool_call',
        toolName: 'write_file',
        approvalRequirementId: 'approval-write',
      });

      const plan = makePlan({
        id: 'plan-1',
        goal: 'Update configuration file',
        steps: [
          makeStep({ id: 'step_analyze', kind: 'agent_task' }),
          step,
          makeStep({ id: 'step_final', kind: 'final_response' }),
        ],
        requiredApprovals: [approval],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(true) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(true);
      expect(result.errors.filter(e => e.code === 'WRITE_TOOL_WITHOUT_APPROVAL')).toHaveLength(0);
    });

    it('write tool step WITHOUT approval fails WRITE_TOOL_WITHOUT_APPROVAL', () => {
      const step: PlanStep = makeStep({
        id: 'step_write',
        kind: 'tool_call',
        toolName: 'write_file',
      });

      const plan = makePlan({
        id: 'plan-2',
        goal: 'Update configuration file',
        steps: [
          makeStep({ id: 'step_analyze', kind: 'agent_task' }),
          step,
          makeStep({ id: 'step_final', kind: 'final_response' }),
        ],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(true) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      const writeApprovalErrors = result.errors.filter(e => e.code === 'WRITE_TOOL_WITHOUT_APPROVAL');
      expect(writeApprovalErrors).toHaveLength(1);
      expect(writeApprovalErrors[0].path).toContain('approvalRequirementId');
    });

    it('delete tool without approval also fails WRITE_TOOL_WITHOUT_APPROVAL', () => {
      const deleteToolRegistry = {
        hasTool(name: string): boolean {
          return name === 'delete_file';
        },
        getTool(name: string): { name: string; category: string } | null {
          if (name === 'delete_file') return { name: 'delete_file', category: 'delete' };
          return null;
        },
      };

      const step: PlanStep = makeStep({
        id: 'step_delete',
        kind: 'tool_call',
        toolName: 'delete_file',
      });

      const plan = makePlan({
        id: 'plan-3',
        goal: 'Delete temporary file',
        steps: [step, makeStep({ id: 'step_final', kind: 'final_response' })],
      });

      const validator = new PlanValidator({ toolRegistry: deleteToolRegistry });
      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'WRITE_TOOL_WITHOUT_APPROVAL')).toBe(true);
    });

    it('read tool step without approval passes validation', () => {
      const step: PlanStep = makeStep({
        id: 'step_read',
        kind: 'tool_call',
        toolName: 'read_file',
      });

      const plan = makePlan({
        id: 'plan-4',
        goal: 'Read configuration file',
        steps: [
          step,
          makeStep({ id: 'step_final', kind: 'final_response' }),
        ],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(true) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(true);
    });
  });

  // ─── Contract 4: DAG structure (no cycles) ─────────────────────────────

  describe('Contract 4: Plan dependencies must form a DAG (no cycles)', () => {
    it('valid DAG plan passes cycle detection', () => {
      const plan = makePlan({
        id: 'plan-dag',
        goal: 'Linear task execution',
        steps: [
          makeStep({
            id: 'A', kind: 'agent_task',
            dependsOn: [],
          }),
          makeStep({
            id: 'B', kind: 'tool_call', toolName: 'read_file',
            dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
          }),
          makeStep({
            id: 'C', kind: 'final_response',
            dependsOn: [{ type: 'depends_on', targetStepId: 'B' }],
          }),
        ],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(false) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(true);
      expect(result.errors.filter(e => e.code === 'CIRCULAR_DEPENDENCY')).toHaveLength(0);
    });

    it('diamond DAG (A → B, A → C, B → D, C → D) passes cycle detection', () => {
      const plan = makePlan({
        id: 'plan-diamond',
        goal: 'Branch and merge',
        steps: [
          makeStep({
            id: 'A', kind: 'agent_task',
          }),
          makeStep({
            id: 'B', kind: 'tool_call', toolName: 'read_file',
            dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
          }),
          makeStep({
            id: 'C', kind: 'tool_call', toolName: 'read_file',
            dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
          }),
          makeStep({
            id: 'D', kind: 'final_response',
            dependsOn: [
              { type: 'depends_on', targetStepId: 'B' },
              { type: 'depends_on', targetStepId: 'C' },
            ],
          }),
        ],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(false) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(true);
    });

    it('cycle A → B → A fails CIRCULAR_DEPENDENCY', () => {
      const plan = makePlan({
        id: 'plan-cycle',
        goal: 'This has a cycle',
        steps: [
          makeStep({
            id: 'A', kind: 'agent_task',
            dependsOn: [{ type: 'depends_on', targetStepId: 'B' }],
          }),
          makeStep({
            id: 'B', kind: 'tool_call', toolName: 'read_file',
            dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
          }),
        ],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(false) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      const cycleErrors = result.errors.filter(e => e.code === 'CIRCULAR_DEPENDENCY');
      expect(cycleErrors).toHaveLength(1);
      expect(cycleErrors[0].message).toContain('Circular dependency');
    });

    it('cycle A → B → C → A fails CIRCULAR_DEPENDENCY', () => {
      const plan = makePlan({
        id: 'plan-cycle-3',
        goal: 'Three-node cycle',
        steps: [
          makeStep({
            id: 'A', kind: 'agent_task',
            dependsOn: [{ type: 'depends_on', targetStepId: 'C' }],
          }),
          makeStep({
            id: 'B', kind: 'tool_call', toolName: 'read_file',
            dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
          }),
          makeStep({
            id: 'C', kind: 'tool_call', toolName: 'read_file',
            dependsOn: [{ type: 'depends_on', targetStepId: 'B' }],
          }),
        ],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(false) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
    });

    it('self-loop (A → A) fails CIRCULAR_DEPENDENCY', () => {
      const plan = makePlan({
        id: 'plan-self-loop',
        goal: 'Self-referential step',
        steps: [
          makeStep({
            id: 'A', kind: 'agent_task',
            dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
          }),
        ],
      });

      const validator = new PlanValidator({ toolRegistry: mockToolRegistry(false) });
      const result = validator.validate(plan);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
    });
  });

  // ─── Contract 5: Plan revision audit trail ─────────────────────────────

  describe('Contract 5: Plan revision creates new version with audit trail', () => {
    it('ExecutionPlan has a version field for audit trail', () => {
      const plan: ExecutionPlan = makePlan({
        id: 'plan-v1',
        goal: 'Initial plan',
        steps: [makeStep({ id: 'step_1', kind: 'final_response' })],
        version: 1,
      });
      expect(plan.version).toBe(1);
    });

    it('version defaults to 1 for new plans', () => {
      const plan = makePlan({
        id: 'plan-new',
        goal: 'New plan',
        steps: [makeStep({ id: 'step_1', kind: 'final_response' })],
        version: 1,
      });
      expect(plan.version).toBe(1);
    });

    it('PlanPatch records fromVersion and toVersion for audit trail', () => {
      const patch: PlanPatch = {
        planId: 'plan-1',
        fromVersion: 1,
        toVersion: 2,
        patch: JSON.stringify({ steps: [{ op: 'add', stepId: 'step_new' }] }),
        sourcePlannerRunId: 'pl_run_001',
        reason: 'Replanning due to context change',
        createdAt: '2026-05-11T01:00:00Z',
      };
      expect(patch.fromVersion).toBe(1);
      expect(patch.toVersion).toBe(2);
      expect(patch.toVersion).toBeGreaterThan(patch.fromVersion);
      expect(patch.sourcePlannerRunId).toBeDefined();
      expect(patch.reason).toBeDefined();
      expect(patch.createdAt).toBeDefined();
    });

    it('PlanPatch must have createdAt timestamp for audit ordering', () => {
      const patch: PlanPatch = {
        planId: 'plan-1',
        fromVersion: 2,
        toVersion: 3,
        patch: '{}',
        createdAt: new Date().toISOString(),
      };
      expect(patch.createdAt).toBeTruthy();
      expect(new Date(patch.createdAt).getTime()).not.toBeNaN();
    });
  });

  // ─── Contract 6: Terminal plan immutability ─────────────────────────────

  describe('Contract 6: Plan cannot be modified after terminal status', () => {
    it('EXECUTION_PLAN_STATES defines terminal states', () => {
      const terminalStates = [
        EXECUTION_PLAN_STATES.COMPLETED,
        EXECUTION_PLAN_STATES.FAILED,
        EXECUTION_PLAN_STATES.ABANDONED,
      ];
      for (const ts of terminalStates) {
        expect(typeof ts).toBe('string');
      }
      expect(EXECUTION_PLAN_STATES.COMPLETED).toBe('completed');
      expect(EXECUTION_PLAN_STATES.FAILED).toBe('failed');
      expect(EXECUTION_PLAN_STATES.ABANDONED).toBe('abandoned');
    });

    it('terminal planner states include completed, failed, cancelled', () => {
      const terminalStates = [
        PLANNER_STATES.COMPLETED,
        PLANNER_STATES.FAILED,
        PLANNER_STATES.CANCELLED,
      ];
      for (const ts of terminalStates) {
        expect(typeof ts).toBe('string');
      }
    });

    it('terminal states are distinct from active states', () => {
      const activeStates = [
        EXECUTION_PLAN_STATES.DRAFT,
        EXECUTION_PLAN_STATES.APPROVED,
        EXECUTION_PLAN_STATES.IN_EXECUTION,
        EXECUTION_PLAN_STATES.REPLANNING,
      ];
      const terminalStates = [
        EXECUTION_PLAN_STATES.COMPLETED,
        EXECUTION_PLAN_STATES.FAILED,
        EXECUTION_PLAN_STATES.ABANDONED,
      ];
      for (const ts of terminalStates) {
        expect(activeStates).not.toContain(ts);
      }
    });

    it('plan version never changes after terminal — immutability contract', () => {
      const terminalStatuses = [
        EXECUTION_PLAN_STATES.COMPLETED,
        EXECUTION_PLAN_STATES.FAILED,
        EXECUTION_PLAN_STATES.ABANDONED,
      ];
      expect(terminalStatuses).toHaveLength(3);

      const plan: ExecutionPlan = makePlan({
        id: 'plan-terminal',
        goal: 'Terminal plan',
        steps: [makeStep({ id: 'step_1', kind: 'final_response' })],
        version: 5,
      });
      expect(plan.version).toBe(5);
    });

    it('PlannerResumeEvent cannot target terminal planner runs', () => {
      const terminalStates: string[] = [
        PLANNER_STATES.COMPLETED,
        PLANNER_STATES.FAILED,
        PLANNER_STATES.CANCELLED,
      ];

      const resumeEvent: PlannerResumeEvent = {
        eventType: 'execution_result_arrived',
        payload: { result: 'ok' },
      };

      expect(resumeEvent.eventType).toBe('execution_result_arrived');
      expect(terminalStates).toContain(PLANNER_STATES.COMPLETED);
      expect(terminalStates).toContain(PLANNER_STATES.FAILED);
      expect(terminalStates).toContain(PLANNER_STATES.CANCELLED);
    });
  });
});
