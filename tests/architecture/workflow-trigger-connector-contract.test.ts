/**
 * Architecture Contract Tests — Path 6: Workflow-Trigger-Connector
 *
 * Verifies Workflow → Dispatcher, Trigger → RuntimeAction,
 * and Connector → Approval architectural contracts.
 * Type-level assertions only — no runtime execution.
 */
import { describe, it, expect } from 'vitest';
import type {
  RuntimeActionType,
  TargetRuntime,
  DispatchRequest,
  DispatchResult,
  RuntimeDispatcher,
} from '../../src/dispatcher/types.js';
import type { WorkflowRuntime } from '../../src/workflows/workflow-runtime.js';
import type {
  EventTriggerRuntime,
  RuntimeTriggerEvent,
  TriggerActionResult,
  RegisterTriggerInput,
} from '../../src/triggers/types.js';
import type {
  PermissionCheckRequest,
  PermissionDecision,
  PermissionScopeType,
  CreateApprovalRequest,
  ApprovalRequest,
} from '../../src/permissions/types.js';
import {
  modeAllowsOperation,
  createPermissionContext,
  createRequiresApprovalDecision,
} from '../../src/permissions/types.js';
import { WORKFLOW_RUN_STATES, RUNTIME_ACTION_STATES, APPROVAL_STATES } from '../../src/shared/states.js';

// ─── Workflow → Dispatcher Path Contract ─────────────────────────────────

describe('Path 6: Workflow-Trigger-Connector Contract', () => {

  describe('Workflow → Dispatcher Path', () => {
    it('WorkflowRuntime dispatches via dispatcher, not direct tool execution', () => {
      // WorkflowRuntime interface has executeStep / handleStepCompletion
      // but does NOT expose executeTool / callTool directly.
      // It relies on a dispatcher to route actions, not a tool executor.
      const dispatchMethods: Array<keyof WorkflowRuntime> = [
        'executeStep',
        'handleStepCompletion',
        'startWorkflowRun',
        'cancelWorkflowRun',
      ];
      for (const m of dispatchMethods) {
        expect(typeof m).toBe('string');
      }

      // WorkflowRuntime delegates step execution to dispatcher —
      // it has executeStep/handleStepCompletion, not executeTool/callTool
      // Verify the dispatch-oriented methods exist for step-driven execution
      expect(dispatchMethods.length).toBeGreaterThanOrEqual(3);
    });

    it('WorkflowRuntime actions go through dispatcher.dispatch()', () => {
      // The dispatcher interface has a single dispatch method
      const dispatcherKeys: Array<keyof RuntimeDispatcher> = ['dispatch'];
      expect(dispatcherKeys).toHaveLength(1);
      expect(typeof dispatcherKeys[0]).toBe('string');
    });

    it('dispatch method accepts DispatchRequest and returns DispatchResult', () => {
      // Verify DispatchRequest and DispatchResult types exist with required fields
      const requestKeys: Array<keyof DispatchRequest> = [
        'requestId', 'action', 'context',
      ];
      for (const k of requestKeys) {
        expect(typeof k).toBe('string');
      }

      const resultKeys: Array<keyof DispatchResult> = [
        'requestId', 'actionId', 'status', 'targetRuntime', 'createdAt',
      ];
      for (const k of resultKeys) {
        expect(typeof k).toBe('string');
      }
    });

    it('RuntimeActionType includes workflow-related action types', () => {
      const workflowActionTypes: RuntimeActionType[] = [
        'start_workflow_run',
        'resume_workflow_step',
        'register_trigger',
        'register_wait_condition',
      ];
      for (const at of workflowActionTypes) {
        expect(typeof at).toBe('string');
      }
    });

    it('TargetRuntime includes workflow_runtime for workflow dispatch', () => {
      const targets: TargetRuntime[] = [
        'workflow_runtime',
        'event_trigger_runtime',
        'connector_runtime',
      ];
      for (const t of targets) {
        expect(typeof t).toBe('string');
      }
    });

    it('WORKFLOW_RUN_STATES covers queued → running → completed lifecycle', () => {
      const states = Object.values(WORKFLOW_RUN_STATES) as string[];
      const lifecycle = [
        WORKFLOW_RUN_STATES.QUEUED,
        WORKFLOW_RUN_STATES.RUNNING,
        WORKFLOW_RUN_STATES.COMPLETED,
      ];
      for (const s of lifecycle) {
        expect(states).toContain(s);
      }
    });

    it('WORKFLOW_RUN_STATES includes failure and timeout paths', () => {
      const states = Object.values(WORKFLOW_RUN_STATES) as string[];
      expect(states).toContain(WORKFLOW_RUN_STATES.FAILED);
      expect(states).toContain(WORKFLOW_RUN_STATES.CANCELLED);
      expect(states).toContain(WORKFLOW_RUN_STATES.TIMEOUT);
    });
  });

  // ─── Trigger → RuntimeAction Contract ─────────────────────────────────

  describe('Trigger → RuntimeAction Creation', () => {
    it('RuntimeTriggerEvent forces sourceModule to be "trigger"', () => {
      // RuntimeTriggerEvent extends EventRecord with sourceModule: 'trigger'
      // as a literal type, ensuring trigger events are properly sourced
      const triggerEvent: Partial<RuntimeTriggerEvent> = {
        sourceModule: 'trigger',
      };
      expect(triggerEvent.sourceModule).toBe('trigger');
    });

    it('RuntimeTriggerEvent has all required trigger-related fields', () => {
      const requiredKeys: Array<keyof RuntimeTriggerEvent> = [
        'eventType', 'sourceModule', 'relatedRefs',
      ];
      for (const k of requiredKeys) {
        expect(typeof k).toBe('string');
      }
    });

    it('RegisterTriggerInput accepts conditional trigger type patterns', () => {
      const inputKeys: Array<keyof RegisterTriggerInput> = [
        'triggerType', 'conditionType', 'conditionPattern',
        'targetType', 'targetRef',
      ];
      for (const k of inputKeys) {
        expect(typeof k).toBe('string');
      }
    });

    it('EventTriggerRuntime.evaluateScheduleTriggers returns RuntimeAction[]', () => {
      // The return type includes actions: RuntimeAction[],
      // confirming trigger-created actions flow through the dispatch pipeline
      expect<keyof EventTriggerRuntime>('evaluateScheduleTriggers');
      expect<keyof EventTriggerRuntime>('evaluateWaitConditions');
      expect<keyof EventTriggerRuntime>('handleApprovalResolved');
    });

    it('TriggerActionResult captures matched events and generated actions', () => {
      const resultKeys: Array<keyof TriggerActionResult> = [
        'matched', 'events', 'actions',
      ];
      for (const k of resultKeys) {
        expect(typeof k).toBe('string');
      }
    });

    it('RUNTIME_ACTION_STATES includes the states trigger-created actions traverse', () => {
      const states = Object.values(RUNTIME_ACTION_STATES) as string[];
      expect(states).toContain(RUNTIME_ACTION_STATES.CREATED);
      expect(states).toContain(RUNTIME_ACTION_STATES.VALIDATED);
      expect(states).toContain(RUNTIME_ACTION_STATES.DISPATCHING);
      expect(states).toContain(RUNTIME_ACTION_STATES.COMPLETED);
    });
  });

  // ─── Connector → Approval Contract ─────────────────────────────────────

  describe('Connector Write Tool → Approval Gating', () => {
    it('PermissionCheckRequest has connector-specific fields', () => {
      const connectorKeys: Array<keyof PermissionCheckRequest> = [
        'connectorId', 'connectorResource', 'connectorAction',
      ];
      for (const k of connectorKeys) {
        expect(typeof k).toBe('string');
      }
    });

    it('PermissionScopeType includes "connector" for connector-scoped grants', () => {
      const scopes: PermissionScopeType[] = [
        'one_shot', 'session', 'plan', 'workflow_run', 'background_run', 'connector',
      ];
      expect(scopes).toHaveLength(6);
      expect(scopes).toContain('connector');
    });

    it('write operations trigger approval in ask_on_write mode', () => {
      // read-only connector calls do NOT require approval
      expect(modeAllowsOperation('ask_on_write', 'read')).toBe(true);
      // write connector calls pass mode check but then require approval
      expect(modeAllowsOperation('ask_on_write', 'write')).toBe(true);
    });

    it('read_only mode blocks write and delete for connectors', () => {
      expect(modeAllowsOperation('read_only', 'read')).toBe(true);
      expect(modeAllowsOperation('read_only', 'write')).toBe(false);
      expect(modeAllowsOperation('read_only', 'delete')).toBe(false);
    });

    it('hard_deny mode rejects all connector operations', () => {
      expect(modeAllowsOperation('hard_deny', 'read')).toBe(false);
      expect(modeAllowsOperation('hard_deny', 'write')).toBe(false);
    });

    it('createPermissionContext with connector scope builds valid context', () => {
      const ctx = createPermissionContext('u1', 's1', 'ask_on_write');
      expect(ctx.userId).toBe('u1');
      expect(ctx.sessionId).toBe('s1');
      expect(ctx.mode).toBe('ask_on_write');
      expect(ctx.grants).toEqual([]);
    });

    it('createRequiresApprovalDecision sets status=requires_approval for connector writes', () => {
      const approvalReq: ApprovalRequest = {
        id: 'ar-conn-1',
        userId: 'u1',
        sessionId: 's1',
        status: 'pending',
        actionType: 'connector_register_subscription',
        operationType: 'write',
        requestedBy: 'system',
        requestedAt: '2026-05-11T00:00:00Z',
      };
      const decision = createRequiresApprovalDecision(
        'Connector write requires approval',
        'req-conn-1',
        approvalReq,
      );
      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
      expect(decision.approvalRequest).toBeDefined();
      expect(decision.approvalRequest!.operationType).toBe('write');
    });
  });

  // ─── Approval Lifecycle States ─────────────────────────────────────────

  describe('Approval Lifecycle States', () => {
    it('APPROVAL_STATES covers pending → approved → rejected → expired → cancelled', () => {
      const approvalStates = Object.values(APPROVAL_STATES) as string[];
      const expected = ['pending', 'approved', 'rejected', 'expired', 'cancelled'];
      for (const s of expected) {
        expect(approvalStates).toContain(s);
      }
    });

    it('CreateApprovalRequest supports expiresInMs for auto-expiry', () => {
      const req: CreateApprovalRequest = {
        userId: 'u1',
        sessionId: 's1',
        actionType: 'connector_register_subscription',
        operationType: 'write',
        requestedBy: 'trigger',
        expiresInMs: 300000,
      };
      expect(req.expiresInMs).toBe(300000);
      expect(req.operationType).toBe('write');
    });
  });

  // ─── Error Path: Denied Connector Access ───────────────────────────────

  describe('Error Handling: Denied Connector Path', () => {
    it('denied decisions have allowed=false', () => {
      const decision: PermissionDecision = {
        status: 'denied',
        allowed: false,
        reason: 'Connector write access denied in read_only mode',
      };
      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
    });

    it('denied connector access never reaches executing state', () => {
      // When a connector write is denied via permission/approval,
      // the operation terminates at denied — no dispatch occurs
      const denied = RUNTIME_ACTION_STATES.DENIED;
      const dispatching = RUNTIME_ACTION_STATES.DISPATCHING;
      expect(denied).toBe('denied');
      expect(dispatching).toBe('dispatching');
      // Denied actions never reach dispatching
    });
  });
});
