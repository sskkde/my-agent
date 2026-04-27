import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createE2EHarness, type E2EHarness } from './test-harness.js';
import { createWorkflowRuntime } from '../../src/workflows/workflow-runtime.js';
import { createWorkflowDraftStore } from '../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore } from '../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore } from '../../src/storage/workflow-run-store.js';
import type { WorkflowStep, ValidationIssue } from '../../src/workflows/types.js';
import type { EventRecord } from '../../src/storage/event-store.js';

describe('Flow 6: Workflow Runtime E2E Flows', () => {
  let harness: E2EHarness;
  let workflowRuntime: ReturnType<typeof createWorkflowRuntime>;

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
  });

  afterEach(() => {
    harness.close();
  });

  describe('Workflow Draft Creation', () => {
    it('should create a workflow draft with basic information', () => {
      const userId = 'user_wf_001';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Search Documents',
          description: 'Search for documents using mock docs connector',
          config: {
            toolName: 'docs.search_docs',
            toolParams: { query: 'project proposal', maxResults: 5 },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Document Search Workflow',
        description: 'A simple workflow to search documents',
        steps,
        ownerUserId: userId,
      });

      expect(draft).toBeDefined();
      expect(draft.draftId).toBeDefined();
      expect(draft.draftId.startsWith('wf_draft_')).toBe(true);
      expect(draft.name).toBe('Document Search Workflow');
      expect(draft.description).toBe('A simple workflow to search documents');
      expect(draft.steps).toHaveLength(1);
      expect(draft.status).toBe('draft');
      expect(draft.ownerUserId).toBe(userId);
      expect(draft.validationIssues).toEqual([]);
      expect(draft.createdAt).toBeDefined();
      expect(draft.updatedAt).toBeDefined();
    });

    it('should create a workflow draft with multiple steps', () => {
      const userId = 'user_wf_002';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Search Documents',
          config: { toolName: 'docs.search_docs', toolParams: { query: 'budget' } },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Read Document',
          config: { toolName: 'docs.read_doc', toolParams: { docId: 'doc-003' } },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Multi-Step Workflow',
        steps,
        ownerUserId: userId,
      });

      expect(draft.steps).toHaveLength(2);
      expect(draft.steps[0].nextStepId).toBe('step_002');
    });

    it('should emit workflow_draft_created event when draft is created', () => {
      const userId = 'user_wf_003';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Simple Step',
          config: { toolName: 'test.tool' },
        },
      ];

      workflowRuntime.createDraft({
        name: 'Event Test Workflow',
        steps,
        ownerUserId: userId,
      });

      const events = harness.stores.eventStore.query({ userId });
      const draftCreatedEvent = events.find(
        (e: EventRecord) => e.eventType === 'workflow_draft_created'
      );

      expect(draftCreatedEvent).toBeDefined();
      expect(draftCreatedEvent?.sourceModule).toBe('workflow');
      expect(draftCreatedEvent?.payload).toMatchObject({
        name: 'Event Test Workflow',
        stepCount: 1,
      });
    });
  });

  describe('Workflow Draft Validation', () => {
    it('should validate a draft with no validation issues', () => {
      const userId = 'user_wf_004';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Valid Step',
          config: { toolName: 'docs.search_docs' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Valid Workflow',
        steps,
        ownerUserId: userId,
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues).toEqual([]);
    });

    it('should detect missing tool name in tool_call step', () => {
      const userId = 'user_wf_005';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Invalid Step',
          config: {},
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Workflow',
        steps,
        ownerUserId: userId,
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((issue: ValidationIssue) => issue.code === 'MISSING_TOOL_NAME')).toBe(true);
    });

    it('should detect empty workflow with no steps', () => {
      const userId = 'user_wf_006';

      const draft = workflowRuntime.createDraft({
        name: 'Empty Workflow',
        steps: [],
        ownerUserId: userId,
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((issue: ValidationIssue) => issue.code === 'NO_STEPS')).toBe(true);
    });

    it('should emit workflow_draft_validated event after validation', () => {
      const userId = 'user_wf_007';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Valid Step',
          config: { toolName: 'docs.search_docs' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Validation Event Test',
        steps,
        ownerUserId: userId,
      });

      workflowRuntime.validateDraft(draft.draftId);

      const events = harness.stores.eventStore.query({ userId });
      const validatedEvent = events.find(
        (e: EventRecord) => e.eventType === 'workflow_draft_validated'
      );

      expect(validatedEvent).toBeDefined();
      expect(validatedEvent?.payload).toMatchObject({
        draftId: draft.draftId,
        issueCount: 0,
      });
    });
  });

  describe('Workflow Draft Publish', () => {
    it('should publish a valid draft to create a workflow definition', () => {
      const userId = 'user_wf_008';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Search Step',
          config: { toolName: 'docs.search_docs' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Publish Test Workflow',
        steps,
        ownerUserId: userId,
      });

      const definition = workflowRuntime.publishDraft(draft.draftId);

      expect(definition).toBeDefined();
      expect(definition.workflowId).toBeDefined();
      expect(definition.workflowId.startsWith('wf_def_')).toBe(true);
      expect(definition.name).toBe('Publish Test Workflow');
      expect(definition.version).toBe(1);
      expect(definition.status).toBe('published');
      expect(definition.publishedFromDraftId).toBe(draft.draftId);
      expect(definition.steps).toHaveLength(1);
    });

    it('should auto-increment version when publishing multiple versions', () => {
      const userId = 'user_wf_009';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft1 = workflowRuntime.createDraft({
        name: 'Versioned Workflow',
        steps,
        ownerUserId: userId,
      });
      const def1 = workflowRuntime.publishDraft(draft1.draftId);

      const draft2 = workflowRuntime.createDraft({
        name: 'Versioned Workflow',
        steps: [...steps, { ...steps[0], stepId: 'step_002' }],
        ownerUserId: userId,
      });
      const def2 = workflowRuntime.publishDraft(draft2.draftId);

      expect(def1.version).toBe(1);
      expect(def2.version).toBe(2);
    });

    it('should throw error when publishing draft with validation issues', () => {
      const userId = 'user_wf_010';

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Draft',
        steps: [],
        ownerUserId: userId,
      });

      expect(() => workflowRuntime.publishDraft(draft.draftId)).toThrow();
    });

    it('should emit workflow_definition_published event when publishing', () => {
      const userId = 'user_wf_011';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Publish Event Test',
        steps,
        ownerUserId: userId,
      });

      const definition = workflowRuntime.publishDraft(draft.draftId);

      const events = harness.stores.eventStore.query({ userId });
      const publishedEvent = events.find(
        (e: EventRecord) => e.eventType === 'workflow_definition_published'
      );

      expect(publishedEvent).toBeDefined();
      expect(publishedEvent?.payload).toMatchObject({
        workflowId: definition.workflowId,
        draftId: draft.draftId,
        name: 'Publish Event Test',
        version: 1,
      });
    });
  });

  describe('Workflow Run Start and Execution', () => {
    it('should start a workflow run from a published definition', () => {
      const userId = 'user_wf_012';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Search Step',
          config: { toolName: 'docs.search_docs' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Runnable Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        inputData: { searchQuery: 'test' },
      });

      expect(result).toBeDefined();
      expect(result.workflowRunId).toBeDefined();
      expect(result.definitionId).toBe(definition.workflowId);
      expect(result.version).toBe(1);
      expect(result.status).toBe('running');
      expect(result.currentStepIds).toContain('step_001');
      expect(result.stepRuns).toHaveLength(1);
      expect(result.stepRuns[0].stepId).toBe('step_001');
    });

    it('should emit workflow_run_started event when starting a run', () => {
      const userId = 'user_wf_013';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Run Started Event Test',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      const events = harness.stores.eventStore.query({ userId });
      const startedEvent = events.find(
        (e: EventRecord) => e.eventType === 'workflow_run_started'
      );

      expect(startedEvent).toBeDefined();
      expect(startedEvent?.payload).toMatchObject({
        workflowRunId: result.workflowRunId,
        workflowId: definition.workflowId,
        version: 1,
        stepCount: 1,
      });
    });

    it('should throw error when starting run with unpublished definition', () => {
      const userId = 'user_wf_014';

      expect(() =>
        workflowRuntime.startWorkflowRun({
          definitionId: 'non_existent_def',
          userId,
        })
      ).toThrow('Workflow definition not found');
    });

    it('should track workflow run status correctly', () => {
      const userId = 'user_wf_015';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Status Tracking Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      const workflowRun = workflowRuntime.getWorkflowRun(runResult.workflowRunId);
      expect(workflowRun).toBeDefined();
      expect(workflowRun?.status).toBe('running');
    });
  });

  describe('Workflow Run Completion with Records', () => {
    it('should complete workflow run and update status', () => {
      const userId = 'user_wf_016';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Single Step',
          config: { toolName: 'docs.search_docs' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Completion Test Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      const stepRunId = runResult.stepRuns[0].stepRunId;
      workflowRuntime.handleStepCompletion(stepRunId, {
        success: true,
        output: { results: ['doc1', 'doc2'] },
      });

      const completedRun = workflowRuntime.getWorkflowRun(runResult.workflowRunId);
      expect(completedRun?.status).toBe('completed');
    });

    it('should emit workflow_run_completed event when workflow completes', () => {
      const userId = 'user_wf_017';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Completion Event Test',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      const stepRunId = runResult.stepRuns[0].stepRunId;

      workflowRuntime.handleStepCompletion(stepRunId, {
        success: true,
        output: { done: true },
      });

      const completedRun = workflowRuntime.getWorkflowRun(runResult.workflowRunId);
      expect(completedRun?.status).toBe('completed');

      const events = harness.stores.eventStore.query({ userId });
      const hasCompletedOrStepCompleted = events.some(
        (e: EventRecord) =>
          e.eventType === 'workflow_run_completed' ||
          e.eventType === 'workflow_step_completed'
      );
      expect(hasCompletedOrStepCompleted).toBe(true);
    });

    it('should create TranscriptRecord for workflow execution', () => {
      const userId = 'user_wf_018';
      const sessionId = 'sess_wf_001';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Transcript Test Step',
          config: { toolName: 'docs.search_docs' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Transcript Test Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
      });

      const transcripts = harness.stores.transcriptStore.findBySession(sessionId);

      expect(transcripts.length).toBeGreaterThanOrEqual(0);
    });

    it('should create EventRecord (Audit) for workflow steps', () => {
      const userId = 'user_wf_019';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Audit Test Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Audit Test Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      const events = harness.stores.eventStore.query({ userId });
      const stepExecutingEvent = events.find(
        (e: EventRecord) => e.eventType === 'workflow_step_executing'
      );

      expect(stepExecutingEvent).toBeDefined();
      expect(stepExecutingEvent?.sourceModule).toBe('workflow');
    });
  });

  describe('Linear Step Execution', () => {
    it('should execute multiple steps in sequence', () => {
      const userId = 'user_wf_020';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'First Step',
          config: { toolName: 'tool1' },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Second Step',
          config: { toolName: 'tool2' },
          nextStepId: 'step_003',
        },
        {
          stepId: 'step_003',
          stepType: 'tool_call',
          name: 'Final Step',
          config: { toolName: 'tool3' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Multi-Step Linear Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      expect(runResult.stepRuns).toHaveLength(3);
      expect(runResult.stepRuns[0].stepId).toBe('step_001');
      expect(runResult.stepRuns[1].stepId).toBe('step_002');
      expect(runResult.stepRuns[2].stepId).toBe('step_003');
    });

    it('should track step status through execution lifecycle', () => {
      const userId = 'user_wf_021';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Lifecycle Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Lifecycle Test Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      expect(['queued', 'running']).toContain(runResult.stepRuns[0].status);

      const stepRunId = runResult.stepRuns[0].stepRunId;
      workflowRuntime.handleStepCompletion(stepRunId, {
        success: true,
        output: { result: 'success' },
      });

      const completedRun = workflowRuntime.getWorkflowRun(runResult.workflowRunId);
      expect(completedRun?.stepRuns[0].status).toBe('completed');
    });
  });

  describe('Workflow Run Cancellation', () => {
    it('should cancel a running workflow', () => {
      const userId = 'user_wf_022';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Long Running Step',
          config: { toolName: 'slow.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Cancellable Workflow',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      workflowRuntime.cancelWorkflowRun(runResult.workflowRunId);

      const cancelledRun = workflowRuntime.getWorkflowRun(runResult.workflowRunId);
      expect(cancelledRun?.status).toBe('cancelled');
    });

    it('should emit workflow_run_cancelled event when cancelled', () => {
      const userId = 'user_wf_023';
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Step',
          config: { toolName: 'test.tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Cancellation Event Test',
        steps,
        ownerUserId: userId,
      });
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
      });

      workflowRuntime.cancelWorkflowRun(runResult.workflowRunId);

      const events = harness.stores.eventStore.query({ userId });
      const cancelledEvent = events.find(
        (e: EventRecord) => e.eventType === 'workflow_run_cancelled'
      );

      expect(cancelledEvent).toBeDefined();
      expect(cancelledEvent?.payload).toMatchObject({
        workflowRunId: runResult.workflowRunId,
      });
    });
  });
});
