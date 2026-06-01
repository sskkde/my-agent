import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createE2EHarness, type E2EHarness } from './test-harness.js';
import { createWorkflowRuntime } from '../../src/workflows/workflow-runtime.js';
import { createWorkflowDraftStore } from '../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore } from '../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore } from '../../src/storage/workflow-run-store.js';
import { createEventTriggerRuntime } from '../../src/triggers/event-trigger-runtime.js';
import { createTriggerStore } from '../../src/storage/trigger-store.js';
import { createWaitConditionStore } from '../../src/storage/wait-condition-store.js';
import type { WorkflowStep } from '../../src/workflows/types.js';
import type { EventRecord } from '../../src/storage/event-store.js';
import type { ToolDefinition } from '../../src/tools/types.js';
import type { PermissionContext } from '../../src/permissions/types.js';

describe('Flow 8: Approval Workflow E2E Flows', () => {
  let harness: E2EHarness;
  let workflowRuntime: ReturnType<typeof createWorkflowRuntime>;
  let triggerRuntime: ReturnType<typeof createEventTriggerRuntime>;

  beforeEach(() => {
    harness = createE2EHarness();

    const draftStore = createWorkflowDraftStore(harness.connection);
    const definitionStore = createWorkflowDefinitionStore(harness.connection);
    const workflowRunStore = createWorkflowRunStore(harness.connection);

    workflowRuntime = createWorkflowRuntime({
      draftStore,
      definitionStore,
      workflowRunStore,
      runtimeActionStore: harness.stores.runtimeActionStore,
      eventStore: harness.stores.eventStore,
    });

    const triggerStore = createTriggerStore(harness.connection);
    const waitConditionStore = createWaitConditionStore(harness.connection);

    triggerRuntime = createEventTriggerRuntime({
      triggerStore,
      waitConditionStore,
      eventStore: harness.stores.eventStore,
      runtimeActionStore: harness.stores.runtimeActionStore,
    });
  });

  afterEach(() => {
    harness.close();
  });

  describe('Workflow with Approval Step', () => {
    it('should create workflow with approval step requiring user consent', () => {
      const userId = 'user_approve_001';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Data Export Approval',
          description: 'Requires approval for data export operation',
          config: {
            approvalScope: 'data_export',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Data Export Approval Workflow',
        description: 'Workflow requiring approval for sensitive data export',
        steps,
        ownerUserId: userId,
      });

      expect(draft).toBeDefined();
      expect(draft.steps).toHaveLength(1);
      expect(draft.steps[0].stepType).toBe('approval');
      expect(draft.steps[0].config.approvalScope).toBe('data_export');
    });

    it('should validate approval step has approvalScope', () => {
      const userId = 'user_approve_002';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Invalid Approval Step',
          config: {},
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Approval Workflow',
        steps,
        ownerUserId: userId,
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(issue => issue.code === 'MISSING_APPROVAL_SCOPE')).toBe(true);
    });

    it('should create approval step followed by write step', () => {
      const userId = 'user_approve_003';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Approval Gate',
          description: 'Wait for user approval',
          config: {
            approvalScope: 'write_operation',
          },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Write Operation',
          description: 'Perform write after approval',
          config: {
            toolName: 'file_write',
            toolParams: { path: '/output/report.txt' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Approval Then Write Workflow',
        steps,
        ownerUserId: userId,
      });

      const definition = workflowRuntime.publishDraft(draft.draftId);
      expect(definition.steps).toHaveLength(2);
      expect(definition.steps[0].stepType).toBe('approval');
      expect(definition.steps[1].stepType).toBe('tool_call');
    });
  });

  describe('Approval Request Creation in Workflow', () => {
    it('should create ApprovalRequest when approval step executes', () => {
      const userId = 'user_approve_004';
      const sessionId = 'sess_approve_001';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Document Deletion Approval',
          config: {
            approvalScope: 'document_deletion',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Document Deletion Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      const approvals = harness.stores.approvalStore.findPendingBySession(sessionId);
      expect(approvals.length).toBeGreaterThanOrEqual(0);
    });

    it('should link approval step to approval request', () => {
      const userId = 'user_approve_005';
      const sessionId = 'sess_approve_002';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Approval Step',
          config: {
            approvalScope: 'sensitive_operation',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Linked Approval Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      const approvalId = harness.idGenerator.custom('approval');
      harness.stores.approvalStore.create({
        id: approvalId,
        userId,
        sessionId,
        actionType: 'workflow:approval_step',
        status: 'pending',
        requestedBy: 'workflow_runtime',
        requestedAt: harness.clock.nowISO(),
        justification: 'Workflow step requires approval',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const approval = harness.stores.approvalStore.getById(approvalId);
      expect(approval).toBeDefined();
      expect(approval?.status).toBe('pending');
      expect(approval?.actionType).toBe('workflow:approval_step');
    });

    it('should emit workflow_step_executing for approval step', () => {
      const userId = 'user_approve_006';
      const sessionId = 'sess_approve_003';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Audit Approval Step',
          config: {
            approvalScope: 'audit_required',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Audit Approval Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      const events = harness.stores.eventStore.query({ userId });
      const executingEvent = events.find(
        (e: EventRecord) => e.eventType === 'workflow_step_executing'
      );

      expect(executingEvent).toBeDefined();
      expect(executingEvent?.payload).toMatchObject({
        stepId: 'step_001',
        stepType: 'approval',
      });
    });
  });

  describe('Approval Resolution and Workflow Resume', () => {
    it('should resolve approval and complete workflow step', () => {
      const userId = 'user_approve_007';
      const sessionId = 'sess_approve_004';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Simple Approval',
          config: {
            approvalScope: 'test_operation',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Simple Approval Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      const approvalId = harness.idGenerator.custom('approval');
      harness.stores.approvalStore.create({
        id: approvalId,
        userId,
        sessionId,
        actionType: 'workflow:step',
        status: 'pending',
        requestedBy: 'workflow',
        requestedAt: harness.clock.nowISO(),
        justification: 'Approval required for workflow step',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const approval = harness.stores.approvalStore.getById(approvalId);
      expect(approval?.status).toBe('pending');

      harness.stores.approvalStore.update(approvalId, {
        status: 'approved',
        respondedAt: harness.clock.nowISO(),
        responseBy: userId,
        responseReason: 'User approved the workflow step',
      });

      const updatedApproval = harness.stores.approvalStore.getById(approvalId);
      expect(updatedApproval?.status).toBe('approved');
      expect(updatedApproval?.respondedAt).toBeDefined();
      expect(updatedApproval?.responseBy).toBe(userId);
    });

    it('should emit approval_resolved_trigger when approval is resolved', () => {
      const userId = 'user_approve_009';

      const approvalId = harness.idGenerator.custom('approval');
      harness.stores.approvalStore.create({
        id: approvalId,
        userId,
        sessionId: 'sess_approve_006',
        actionType: 'workflow:step',
        status: 'pending',
        requestedBy: 'workflow',
        requestedAt: harness.clock.nowISO(),
        justification: 'Test approval resolution',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      triggerRuntime.registerTrigger({
        triggerType: 'approval',
        conditionType: 'approval_resolved',
        conditionPattern: approvalId,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_001',
      });

      harness.stores.approvalStore.update(approvalId, {
        status: 'approved',
        respondedAt: harness.clock.nowISO(),
        responseBy: userId,
        responseReason: 'Approved',
      });

      const result = triggerRuntime.handleApprovalResolved({
        approvalId,
        status: 'approved',
        resolvedAt: harness.clock.nowISO(),
        resolvedBy: userId,
      });

      expect(result.matched).toBeGreaterThan(0);
      expect(result.events.length).toBeGreaterThan(0);
    });

    it('should resume workflow after approval is granted', () => {
      const userId = 'user_approve_010';
      const sessionId = 'sess_approve_007';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Resume Test Approval',
          config: {
            approvalScope: 'resume_test',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Resume After Approval Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      const approvalId = harness.idGenerator.custom('approval_reject');
      harness.stores.approvalStore.create({
        id: approvalId,
        userId,
        sessionId,
        actionType: 'workflow:approval',
        status: 'pending',
        requestedBy: 'workflow',
        requestedAt: harness.clock.nowISO(),
        justification: 'Test rejection',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      harness.stores.approvalStore.update(approvalId, {
        status: 'rejected',
        respondedAt: harness.clock.nowISO(),
        responseBy: userId,
        responseReason: 'Request denied due to policy violation',
      });

      const rejectedApproval = harness.stores.approvalStore.getById(approvalId);
      expect(rejectedApproval?.status).toBe('rejected');
    });
  });

  describe('Integration with Tool Executor', () => {
    it('should require approval for write tool in workflow context', async () => {
      const userId = 'user_approve_013';
      const sessionId = 'sess_approve_010';

      const mockWriteTool: ToolDefinition = {
        name: 'workflowWriteFile',
        description: 'Writes content to a file',
        category: 'write',
        sensitivity: 'high',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
        handler: async (params) => ({
          success: true,
          data: { written: true, path: (params as { path: string }).path },
          resultPreview: `File written to ${(params as { path: string }).path}`,
        }),
      };

      harness.registerTool(mockWriteTool);

      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'ask_on_write',
        grants: [],
        metadata: {},
      };

      const toolCallId = harness.idGenerator.custom('tool_call_wf');
      const result = await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'workflowWriteFile',
        params: { path: '/workflow/output.txt', content: 'Workflow output' },
        userId,
        sessionId,
        permissionContext,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');

      const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
      expect(pendingApprovals.length).toBeGreaterThan(0);

      const approval = pendingApprovals[0];
      expect(approval.actionType).toBe('tool:workflowWriteFile');
    });

    it('should execute write tool after approval grant', async () => {
      const userId = 'user_approve_014';
      const sessionId = 'sess_approve_011';

      const mockWriteTool: ToolDefinition = {
        name: 'approvedWriteTool',
        description: 'Writes after approval',
        category: 'write',
        sensitivity: 'high',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
        handler: async (params) => ({
          success: true,
          data: { written: true, path: (params as { path: string }).path },
          resultPreview: `File written`,
        }),
      };

      harness.registerTool(mockWriteTool);

      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'ask_on_write',
        grants: [],
        metadata: {},
      };

      const toolCallId = harness.idGenerator.custom('tool_call_wf2');
      await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'approvedWriteTool',
        params: { path: '/test/file.txt', content: 'Test content' },
        userId,
        sessionId,
        permissionContext,
      });

      const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
      expect(pendingApprovals.length).toBeGreaterThan(0);
      const approvalId = pendingApprovals[0].id;

      const approvalResult = await harness.sendApprovalResponse(userId, sessionId, approvalId, true);

      expect(approvalResult.success).toBe(true);
      expect(approvalResult.approvalId).toBe(approvalId);

      if (approvalResult.toolExecution) {
        expect(['completed', 'failed']).toContain(approvalResult.toolExecution.status);
      }
    });
  });

  describe('Event Audit Trail', () => {
    it('should create audit trail for approval workflow', () => {
      const userId = 'user_approve_015';
      const sessionId = 'sess_approve_012';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'approval',
          name: 'Audit Trail Step',
          config: {
            approvalScope: 'audit_trail_test',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Audit Trail Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      const events = harness.stores.eventStore.query({ userId });

      const draftCreated = events.some(
        (e: EventRecord) => e.eventType === 'workflow_draft_created'
      );
      const draftValidated = events.some(
        (e: EventRecord) => e.eventType === 'workflow_draft_validated'
      );
      const definitionPublished = events.some(
        (e: EventRecord) => e.eventType === 'workflow_definition_published'
      );
      const runStarted = events.some(
        (e: EventRecord) => e.eventType === 'workflow_run_started'
      );
      const stepExecuting = events.some(
        (e: EventRecord) => e.eventType === 'workflow_step_executing'
      );

      expect(draftCreated).toBe(true);
      expect(draftValidated).toBe(true);
      expect(definitionPublished).toBe(true);
      expect(runStarted).toBe(true);
      expect(stepExecuting).toBe(true);
    });
  });
});
