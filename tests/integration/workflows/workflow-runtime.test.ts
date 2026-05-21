import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createWorkflowDraftStore, type WorkflowDraftStore } from '../../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore, type WorkflowDefinitionStore } from '../../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore, type WorkflowRunStore } from '../../../src/storage/workflow-run-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { WORKFLOW_RUN_STATES } from '../../../src/shared/states.js';
import {
  createWorkflowRuntime,
  type WorkflowRuntime,
} from '../../../src/workflows/workflow-runtime.js';
import type {
  WorkflowStep,
} from '../../../src/workflows/types.js';

// Migrations for workflow runtime tables
const workflowRuntimeMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_workflow_drafts_table',
    up: `
      CREATE TABLE workflow_drafts (
        draft_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        steps TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft', 'validating', 'invalid')),
        validation_issues TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_workflow_drafts_owner ON workflow_drafts(owner_user_id);
      CREATE INDEX idx_workflow_drafts_status ON workflow_drafts(status);
      CREATE INDEX idx_workflow_drafts_updated ON workflow_drafts(updated_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_workflow_drafts_updated;
      DROP INDEX IF EXISTS idx_workflow_drafts_status;
      DROP INDEX IF EXISTS idx_workflow_drafts_owner;
      DROP TABLE IF EXISTS workflow_drafts;
    `
  },
  {
    version: 2,
    name: 'create_workflow_definitions_table',
    up: `
      CREATE TABLE workflow_definitions (
        workflow_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version INTEGER NOT NULL,
        steps TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('published', 'deprecated')),
        published_from_draft_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_workflow_defs_owner ON workflow_definitions(owner_user_id);
      CREATE INDEX idx_workflow_defs_status ON workflow_definitions(status);
      CREATE INDEX idx_workflow_defs_name_version ON workflow_definitions(name, version);
      CREATE INDEX idx_workflow_defs_draft ON workflow_definitions(published_from_draft_id);
      CREATE INDEX idx_workflow_defs_updated ON workflow_definitions(updated_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_workflow_defs_updated;
      DROP INDEX IF EXISTS idx_workflow_defs_draft;
      DROP INDEX IF EXISTS idx_workflow_defs_name_version;
      DROP INDEX IF EXISTS idx_workflow_defs_status;
      DROP INDEX IF EXISTS idx_workflow_defs_owner;
      DROP TABLE IF EXISTS workflow_definitions;
    `
  },
  {
    version: 3,
    name: 'create_workflow_runs_table',
    up: `
      CREATE TABLE workflow_runs (
        workflow_run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        trigger_event_id TEXT,
        status TEXT NOT NULL,
        current_step_ids TEXT,
        input_data TEXT,
        output_data TEXT,
        context_data TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
      CREATE INDEX idx_workflow_runs_owner_status ON workflow_runs(owner_user_id, status);
      CREATE INDEX idx_workflow_runs_trigger ON workflow_runs(trigger_event_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_workflow_runs_trigger;
      DROP INDEX IF EXISTS idx_workflow_runs_owner_status;
      DROP INDEX IF EXISTS idx_workflow_runs_workflow;
      DROP TABLE IF EXISTS workflow_runs;
    `
  },
  {
    version: 4,
    name: 'create_workflow_step_runs_table',
    up: `
      CREATE TABLE workflow_step_runs (
        step_run_id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        step_type TEXT NOT NULL,
        status TEXT NOT NULL,
        kernel_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        approval_id TEXT,
        input_data TEXT,
        output_data TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_workflow_step_runs_workflow_status ON workflow_step_runs(workflow_run_id, status);
      CREATE INDEX idx_workflow_step_runs_step_id ON workflow_step_runs(step_id);
      CREATE INDEX idx_workflow_step_runs_kernel ON workflow_step_runs(kernel_run_id);
      CREATE INDEX idx_workflow_step_runs_subagent ON workflow_step_runs(subagent_run_id);
      CREATE INDEX idx_workflow_step_runs_tool ON workflow_step_runs(tool_call_id);
      CREATE INDEX idx_workflow_step_runs_approval ON workflow_step_runs(approval_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_workflow_step_runs_approval;
      DROP INDEX IF EXISTS idx_workflow_step_runs_tool;
      DROP INDEX IF EXISTS idx_workflow_step_runs_subagent;
      DROP INDEX IF EXISTS idx_workflow_step_runs_kernel;
      DROP INDEX IF EXISTS idx_workflow_step_runs_step_id;
      DROP INDEX IF EXISTS idx_workflow_step_runs_workflow_status;
      DROP TABLE IF EXISTS workflow_step_runs;
    `
  },
  {
    version: 5,
    name: 'create_runtime_actions_table',
    up: `
      CREATE TABLE runtime_actions (
        action_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        idempotency_key TEXT,
        source_module TEXT NOT NULL,
        source_action TEXT,
        target_runtime TEXT NOT NULL,
        target_action TEXT NOT NULL,
        payload TEXT NOT NULL,
        correlation_id TEXT,
        causation_id TEXT,
        session_id TEXT,
        user_id TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        status TEXT NOT NULL,
        status_message TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
      CREATE INDEX idx_runtime_actions_workflow_run ON runtime_actions(workflow_run_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_runtime_actions_workflow_run;
      DROP INDEX IF EXISTS idx_runtime_actions_status;
      DROP TABLE IF EXISTS runtime_actions;
    `
  },
  {
    version: 6,
    name: 'create_events_table',
    up: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source_module TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        idempotency_key TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        approval_id TEXT,
        wait_condition_id TEXT,
        artifact_id TEXT,
        memory_id TEXT,
        payload TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        retention_class TEXT NOT NULL,
        created_at TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_events_session ON events(session_id);
      CREATE INDEX idx_events_user ON events(user_id);
      CREATE INDEX idx_events_type ON events(event_type);
      CREATE INDEX idx_events_correlation ON events(correlation_id);
      CREATE INDEX idx_events_causation ON events(causation_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_causation;
      DROP INDEX IF EXISTS idx_events_correlation;
      DROP INDEX IF EXISTS idx_events_type;
      DROP INDEX IF EXISTS idx_events_user;
      DROP INDEX IF EXISTS idx_events_session;
      DROP TABLE IF EXISTS events;
    `
  },
];

function createValidSteps(): WorkflowStep[] {
  return [
    {
      stepId: 'step_001',
      stepType: 'tool_call',
      name: 'Call Test Tool',
      description: 'Executes a test tool',
      config: {
        toolName: 'test_tool',
        toolParams: { param1: 'value1' },
        retryPolicy: { maxRetries: 3, retryDelayMs: 1000 },
        onFailure: 'fail',
      },
      nextStepId: 'step_002',
    },
    {
      stepId: 'step_002',
      stepType: 'agent_run',
      name: 'Run Agent',
      description: 'Runs an agent task',
      config: {
        agentId: 'test_agent',
        agentParams: { task: 'process_data' },
      },
    },
  ];
}

function createInvalidSteps(): WorkflowStep[] {
  return [
    {
      stepId: 'step_001',
      stepType: 'tool_call',
      name: 'Missing Tool Name',
      description: 'Step with missing tool name',
      config: {
        toolParams: { param1: 'value1' },
      },
    },
    {
      stepId: 'step_002',
      stepType: 'invalid_type' as WorkflowStep['stepType'],
      name: 'Invalid Step Type',
      description: 'Step with invalid type',
      config: {},
      nextStepId: 'nonexistent_step',
    },
  ];
}

describe('Workflow Runtime Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let draftStore: WorkflowDraftStore;
  let definitionStore: WorkflowDefinitionStore;
  let workflowRunStore: WorkflowRunStore;
  let runtimeActionStore: RuntimeActionStore;
  let eventStore: EventStore;
  let workflowRuntime: WorkflowRuntime;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(workflowRuntimeMigrations);

    draftStore = createWorkflowDraftStore(connection);
    definitionStore = createWorkflowDefinitionStore(connection);
    workflowRunStore = createWorkflowRunStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);
    eventStore = createEventStore(connection);

    workflowRuntime = createWorkflowRuntime({
      draftStore,
      definitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('createDraft', () => {
    it('should create a workflow draft with valid steps', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Test Workflow',
        description: 'A test workflow',
        steps,
        ownerUserId: 'user_001',
      });

      expect(draft.draftId).toBeDefined();
      expect(draft.name).toBe('Test Workflow');
      expect(draft.description).toBe('A test workflow');
      expect(draft.steps).toHaveLength(2);
      expect(draft.ownerUserId).toBe('user_001');
      expect(draft.status).toBe('draft');
      expect(draft.validationIssues).toEqual([]);
      expect(draft.createdAt).toBeDefined();
      expect(draft.updatedAt).toBeDefined();
    });

    it('should persist draft to store', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Persisted Workflow',
        steps,
        ownerUserId: 'user_002',
      });

      const retrieved = draftStore.getDraftById(draft.draftId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Persisted Workflow');
    });
  });

  describe('validateDraft', () => {
    it('should return empty issues for valid draft', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Valid Workflow',
        steps,
        ownerUserId: 'user_003',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues).toHaveLength(0);

      const updatedDraft = draftStore.getDraftById(draft.draftId);
      expect(updatedDraft?.status).toBe('draft');
      expect(updatedDraft?.validationIssues).toHaveLength(0);
    });

    it('should detect validation issues for invalid draft', () => {
      const steps = createInvalidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Invalid Workflow',
        steps,
        ownerUserId: 'user_004',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.code === 'MISSING_TOOL_NAME')).toBe(true);
      expect(issues.some(i => i.code === 'INVALID_STEP_TYPE')).toBe(true);
      expect(issues.some(i => i.code === 'INVALID_NEXT_STEP')).toBe(true);

      const updatedDraft = draftStore.getDraftById(draft.draftId);
      expect(updatedDraft?.status).toBe('invalid');
      expect(updatedDraft?.validationIssues.length).toBeGreaterThan(0);
    });

    it('should throw error for non-existent draft', () => {
      expect(() => {
        workflowRuntime.validateDraft('nonexistent_draft');
      }).toThrow('Draft not found');
    });

    it('should detect empty steps', () => {
      const draft = workflowRuntime.createDraft({
        name: 'Empty Workflow',
        steps: [],
        ownerUserId: 'user_005',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.some(i => i.code === 'NO_STEPS')).toBe(true);
    });

    it('should detect duplicate step IDs', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'First Step',
          config: { toolName: 'tool1' },
        },
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Duplicate Step',
          config: { toolName: 'tool2' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Duplicate Steps Workflow',
        steps,
        ownerUserId: 'user_006',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.some(i => i.code === 'DUPLICATE_STEP_ID')).toBe(true);
    });

    it('should detect cycles in workflow', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Step 1',
          config: { toolName: 'tool1' },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Step 2',
          config: { toolName: 'tool2' },
          nextStepId: 'step_001',
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Cyclic Workflow',
        steps,
        ownerUserId: 'user_007',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.some(i => i.code === 'CYCLE_DETECTED')).toBe(true);
    });
  });

  describe('publishDraft', () => {
    it('should publish valid draft and create definition', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Publish Test Workflow',
        description: 'To be published',
        steps,
        ownerUserId: 'user_008',
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      expect(definition.workflowId).toBeDefined();
      expect(definition.name).toBe('Publish Test Workflow');
      expect(definition.description).toBe('To be published');
      expect(definition.version).toBe(1);
      expect(definition.steps).toHaveLength(2);
      expect(definition.ownerUserId).toBe('user_008');
      expect(definition.status).toBe('published');
      expect(definition.publishedFromDraftId).toBe(draft.draftId);
      expect(definition.createdAt).toBeDefined();
      expect(definition.updatedAt).toBeDefined();
    });

    it('should increment version for same workflow name', () => {
      const steps = createValidSteps();

      const draft1 = workflowRuntime.createDraft({
        name: 'Versioned Workflow',
        steps,
        ownerUserId: 'user_009',
      });
      workflowRuntime.validateDraft(draft1.draftId);
      const def1 = workflowRuntime.publishDraft(draft1.draftId);

      const draft2 = workflowRuntime.createDraft({
        name: 'Versioned Workflow',
        steps,
        ownerUserId: 'user_009',
      });
      workflowRuntime.validateDraft(draft2.draftId);
      const def2 = workflowRuntime.publishDraft(draft2.draftId);

      expect(def1.version).toBe(1);
      expect(def2.version).toBe(2);
    });

    it('should throw error for invalid draft', () => {
      const steps = createInvalidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Invalid Workflow',
        steps,
        ownerUserId: 'user_010',
      });

      expect(() => {
        workflowRuntime.publishDraft(draft.draftId);
      }).toThrow('Cannot publish draft with validation issues');
    });

    it('should throw error for non-existent draft', () => {
      expect(() => {
        workflowRuntime.publishDraft('nonexistent_draft');
      }).toThrow('Draft not found');
    });
  });

  describe('startWorkflowRun', () => {
    it('should start a workflow run from definition', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Run Test Workflow',
        steps,
        ownerUserId: 'user_011',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_011',
        sessionId: 'session_001',
        inputData: { key: 'value' },
      });

      expect(result.workflowRunId).toBeDefined();
      expect(result.definitionId).toBe(definition.workflowId);
      expect(result.version).toBe(1);
      expect(result.status).toBe(WORKFLOW_RUN_STATES.RUNNING);
      expect(result.currentStepIds).toContain('step_001');
      expect(result.stepRuns).toHaveLength(2);
    });

    it('should throw error for non-existent definition', () => {
      expect(() => {
        workflowRuntime.startWorkflowRun({
          definitionId: 'nonexistent_definition',
          userId: 'user_012',
        });
      }).toThrow('Workflow definition not found');
    });

    it('should throw error for deprecated definition', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Deprecated Workflow',
        steps,
        ownerUserId: 'user_013',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      definitionStore.deprecateDefinition(definition.workflowId);

      expect(() => {
        workflowRuntime.startWorkflowRun({
          definitionId: definition.workflowId,
          userId: 'user_013',
        });
      }).toThrow('Workflow definition is not published');
    });
  });

  describe('executeStep and handleStepCompletion', () => {
    it('should create runtime action when executing step', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Tool Step',
          config: { toolName: 'test_tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Execute Step Workflow',
        steps,
        ownerUserId: 'user_014',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_014',
      });

      const stepRunId = result.stepRuns[0]?.stepRunId;
      expect(stepRunId).toBeDefined();

      const actions = runtimeActionStore.query({ workflowRunId: result.workflowRunId });
      expect(actions.length).toBeGreaterThan(0);

      const toolAction = actions.find(a => a.targetAction === 'execute_tool');
      expect(toolAction).toBeDefined();
      expect(toolAction?.targetRuntime).toBe('tool_plane');
    });

    it('should advance to next step on successful completion', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'First Step',
          config: { toolName: 'test_tool' },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Second Step',
          config: { toolName: 'test_tool2' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Linear Workflow',
        steps,
        ownerUserId: 'user_015',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_015',
      });

      const firstStepRunId = result.stepRuns[0]?.stepRunId;
      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { result: 'step1_done' },
      });

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.currentStepIds).toContain('step_002');
    });

    it('should complete workflow when last step finishes', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Only Step',
          config: { toolName: 'test_tool' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Single Step Workflow',
        steps,
        ownerUserId: 'user_016',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_016',
      });

      const stepRunId = result.stepRuns[0]?.stepRunId;
      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: true,
        output: { final: 'result' },
      });

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED);
    });

    it('should fail workflow on step failure', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Failing Step',
          config: { toolName: 'test_tool', onFailure: 'fail' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Failing Workflow',
        steps,
        ownerUserId: 'user_017',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_017',
      });

      const stepRunId = result.stepRuns[0]?.stepRunId;
      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Step execution failed',
      });

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED);
    });

    it('should continue workflow on step failure when onFailure is continue', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Failing Step',
          config: { toolName: 'test_tool', onFailure: 'continue' },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Second Step',
          config: { toolName: 'test_tool2' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Continue On Failure Workflow',
        steps,
        ownerUserId: 'user_018',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_018',
      });

      const firstStepRunId = result.stepRuns[0]?.stepRunId;
      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: false,
        error: 'Step failed but continuing',
      });

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.currentStepIds).toContain('step_002');
    });
  });

  describe('cancelWorkflowRun', () => {
    it('should cancel running workflow', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Cancel Test Workflow',
        steps,
        ownerUserId: 'user_019',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_019',
      });

      workflowRuntime.cancelWorkflowRun(result.workflowRunId);

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED);
    });

    it('should cancel all step runs', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Cancel Steps Workflow',
        steps,
        ownerUserId: 'user_020',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_020',
      });

      workflowRuntime.cancelWorkflowRun(result.workflowRunId);

      const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);
      expect(stepRuns.every(sr => sr.status === WORKFLOW_RUN_STATES.CANCELLED)).toBe(true);
    });

    it('should throw error for non-existent workflow run', () => {
      expect(() => {
        workflowRuntime.cancelWorkflowRun('nonexistent_run');
      }).toThrow('Workflow run not found');
    });
  });

  describe('getWorkflowRun', () => {
    it('should return null for non-existent run', () => {
      const result = workflowRuntime.getWorkflowRun('nonexistent_run');
      expect(result).toBeNull();
    });

    it('should return workflow run with step info', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Get Run Workflow',
        steps,
        ownerUserId: 'user_021',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const started = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_021',
        sessionId: 'session_002',
      });

      const result = workflowRuntime.getWorkflowRun(started.workflowRunId);

      expect(result).not.toBeNull();
      expect(result?.workflowRunId).toBe(started.workflowRunId);
      expect(result?.definitionId).toBe(definition.workflowId);
      expect(result?.version).toBe(1);
      expect(result?.stepRuns).toHaveLength(2);
    });
  });

  describe('Event Emission', () => {
    it('should emit events during draft creation', () => {
      const steps = createValidSteps();
      workflowRuntime.createDraft({
        name: 'Event Test Workflow',
        steps,
        ownerUserId: 'user_022',
      });

      const events = eventStore.query({ eventType: 'workflow_draft_created' });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should emit events during validation', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Validation Event Workflow',
        steps,
        ownerUserId: 'user_023',
      });

      workflowRuntime.validateDraft(draft.draftId);

      const events = eventStore.query({ eventType: 'workflow_draft_validated' });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should emit events during publish', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Publish Event Workflow',
        steps,
        ownerUserId: 'user_024',
      });
      workflowRuntime.validateDraft(draft.draftId);
      workflowRuntime.publishDraft(draft.draftId);

      const events = eventStore.query({ eventType: 'workflow_definition_published' });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should emit events during workflow run', () => {
      const steps = createValidSteps();
      const draft = workflowRuntime.createDraft({
        name: 'Run Event Workflow',
        steps,
        ownerUserId: 'user_025',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_025',
      });

      const events = eventStore.query({ eventType: 'workflow_run_started' });
      expect(events.length).toBeGreaterThan(0);
    });
  });
});
