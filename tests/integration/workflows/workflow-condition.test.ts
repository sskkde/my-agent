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
import type { WorkflowStep } from '../../../src/workflows/types.js';
import { evaluateConditionExpression } from '../../../src/workflows/expression-evaluator.js';

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

describe('Workflow Condition and Branch Execution', () => {
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

  describe('Expression Evaluator', () => {
    it('should evaluate simple equality comparison', () => {
      const stepOutputs = new Map<string, unknown>();
      stepOutputs.set('step1', { priority: 'high' });

      const result = evaluateConditionExpression('step1.priority == "high"', stepOutputs);

      expect(result.error).toBeUndefined();
      expect(result.conditionMet).toBe(true);
    });

    it('should evaluate false condition correctly', () => {
      const stepOutputs = new Map<string, unknown>();
      stepOutputs.set('step1', { priority: 'low' });

      const result = evaluateConditionExpression('step1.priority == "high"', stepOutputs);

      expect(result.error).toBeUndefined();
      expect(result.conditionMet).toBe(false);
    });

    it('should return UNDEFINED_VARIABLE error for missing variable', () => {
      const stepOutputs = new Map<string, unknown>();
      stepOutputs.set('step1', { priority: 'high' });

      const result = evaluateConditionExpression('missing.value == "test"', stepOutputs);

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('UNDEFINED_VARIABLE');
      expect(result.error?.variableName).toBe('missing');
    });

    it('should return UNDEFINED_VARIABLE error for missing property', () => {
      const stepOutputs = new Map<string, unknown>();
      stepOutputs.set('step1', { priority: 'high' });

      const result = evaluateConditionExpression('step1.nonexistent == "test"', stepOutputs);

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('UNDEFINED_VARIABLE');
      expect(result.error?.variableName).toBe('step1.nonexistent');
    });

    it('should evaluate numeric comparison', () => {
      const stepOutputs = new Map<string, unknown>();
      stepOutputs.set('step1', { count: 10 });

      const result = evaluateConditionExpression('step1.count > 5', stepOutputs);

      expect(result.error).toBeUndefined();
      expect(result.conditionMet).toBe(true);
    });

    it('should evaluate logical AND expression', () => {
      const stepOutputs = new Map<string, unknown>();
      stepOutputs.set('step1', { priority: 'high', count: 10 });

      const result = evaluateConditionExpression('step1.priority == "high" && step1.count > 5', stepOutputs);

      expect(result.error).toBeUndefined();
      expect(result.conditionMet).toBe(true);
    });

    it('should evaluate logical OR expression', () => {
      const stepOutputs = new Map<string, unknown>();
      stepOutputs.set('step1', { priority: 'low', count: 10 });

      const result = evaluateConditionExpression('step1.priority == "high" || step1.count > 5', stepOutputs);

      expect(result.error).toBeUndefined();
      expect(result.conditionMet).toBe(true);
    });

    it('should access input data', () => {
      const stepOutputs = new Map<string, unknown>();
      const inputData = { userRole: 'admin' };

      const result = evaluateConditionExpression('input.userRole == "admin"', stepOutputs, inputData);

      expect(result.error).toBeUndefined();
      expect(result.conditionMet).toBe(true);
    });
  });

  describe('Condition Step Execution', () => {
    it('should route to true branch when condition is met', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_set_priority',
          stepType: 'tool_call',
          name: 'Set Priority',
          config: { toolName: 'set_priority' },
          nextStepId: 'step_check_priority',
        },
        {
          stepId: 'step_check_priority',
          stepType: 'condition',
          name: 'Check Priority',
          config: {
            conditionExpression: 'step_set_priority.priority == "high"',
            trueNextStepId: 'step_high_priority',
            falseNextStepId: 'step_low_priority',
          },
        },
        {
          stepId: 'step_high_priority',
          stepType: 'tool_call',
          name: 'High Priority Handler',
          config: { toolName: 'handle_high' },
        },
        {
          stepId: 'step_low_priority',
          stepType: 'tool_call',
          name: 'Low Priority Handler',
          config: { toolName: 'handle_low' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Priority Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues).toHaveLength(0);

      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_001',
      });

      expect(result.status).toBe(WORKFLOW_RUN_STATES.RUNNING);
      expect(result.currentStepIds).toContain('step_set_priority');

      const firstStepRunId = result.stepRuns.find(sr => sr.stepId === 'step_set_priority')?.stepRunId;
      expect(firstStepRunId).toBeDefined();

      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { priority: 'high' },
      });

      const afterConditionRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(afterConditionRun?.currentStepIds).toContain('step_high_priority');

      const lowPriorityStepRun = result.stepRuns.find(sr => sr.stepId === 'step_low_priority');
      expect(lowPriorityStepRun?.status).toBe(WORKFLOW_RUN_STATES.QUEUED);
    });

    it('should route to false branch when condition is not met', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_set_priority',
          stepType: 'tool_call',
          name: 'Set Priority',
          config: { toolName: 'set_priority' },
          nextStepId: 'step_check_priority',
        },
        {
          stepId: 'step_check_priority',
          stepType: 'condition',
          name: 'Check Priority',
          config: {
            conditionExpression: 'step_set_priority.priority == "high"',
            trueNextStepId: 'step_high_priority',
            falseNextStepId: 'step_low_priority',
          },
        },
        {
          stepId: 'step_high_priority',
          stepType: 'tool_call',
          name: 'High Priority Handler',
          config: { toolName: 'handle_high' },
        },
        {
          stepId: 'step_low_priority',
          stepType: 'tool_call',
          name: 'Low Priority Handler',
          config: { toolName: 'handle_low' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Priority Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_001',
      });

      const firstStepRunId = result.stepRuns.find(sr => sr.stepId === 'step_set_priority')?.stepRunId;

      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { priority: 'low' },
      });

      const afterConditionRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(afterConditionRun?.currentStepIds).toContain('step_low_priority');
    });

    it('should fail workflow when undefined variable and onFailure is fail', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_set_data',
          stepType: 'tool_call',
          name: 'Set Data',
          config: { toolName: 'set_data' },
          nextStepId: 'step_check_undefined',
        },
        {
          stepId: 'step_check_undefined',
          stepType: 'condition',
          name: 'Check Undefined Variable',
          config: {
            conditionExpression: 'missing.value == "test"',
            trueNextStepId: 'step_true_branch',
            falseNextStepId: 'step_false_branch',
            onFailure: 'fail',
          },
        },
        {
          stepId: 'step_true_branch',
          stepType: 'tool_call',
          name: 'True Branch',
          config: { toolName: 'handle_true' },
        },
        {
          stepId: 'step_false_branch',
          stepType: 'tool_call',
          name: 'False Branch',
          config: { toolName: 'handle_false' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Undefined Variable Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_001',
      });

      const firstStepRunId = result.stepRuns.find(sr => sr.stepId === 'step_set_data')?.stepRunId;

      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { data: 'test' },
      });

      const afterConditionRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(afterConditionRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED);

      const conditionStepRun = afterConditionRun?.stepRuns.find(sr => sr.stepId === 'step_check_undefined');
      expect(conditionStepRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED);

      const events = eventStore.query({ eventType: 'workflow_step_failed' });
      expect(events.length).toBeGreaterThan(0);
      const failedEvent = events[0];
      const payload = failedEvent?.payload as { errorCategory?: string };
      expect(payload?.errorCategory).toBe('undefined_variable');
    });

    it('should continue workflow when undefined variable and onFailure is continue', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_set_data',
          stepType: 'tool_call',
          name: 'Set Data',
          config: { toolName: 'set_data' },
          nextStepId: 'step_check_undefined',
        },
        {
          stepId: 'step_check_undefined',
          stepType: 'condition',
          name: 'Check Undefined Variable',
          config: {
            conditionExpression: 'missing.value == "test"',
            trueNextStepId: 'step_true_branch',
            falseNextStepId: 'step_false_branch',
            onFailure: 'continue',
          },
        },
        {
          stepId: 'step_true_branch',
          stepType: 'tool_call',
          name: 'True Branch',
          config: { toolName: 'handle_true' },
        },
        {
          stepId: 'step_false_branch',
          stepType: 'tool_call',
          name: 'False Branch',
          config: { toolName: 'handle_false' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Continue on Error Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_001',
      });

      const firstStepRunId = result.stepRuns.find(sr => sr.stepId === 'step_set_data')?.stepRunId;

      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { data: 'test' },
      });

      const afterConditionRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(afterConditionRun?.status).toBe(WORKFLOW_RUN_STATES.RUNNING);

      const conditionStepRun = afterConditionRun?.stepRuns.find(sr => sr.stepId === 'step_check_undefined');
      expect(conditionStepRun?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED);
    });
  });

  describe('Branch Step Execution', () => {
    it('should execute selected branch and skip others', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_set_priority',
          stepType: 'tool_call',
          name: 'Set Priority',
          config: { toolName: 'set_priority' },
          nextStepId: 'step_branch',
        },
        {
          stepId: 'step_branch',
          stepType: 'branch',
          name: 'Priority Branch',
          config: {
            branches: [
              {
                branchId: 'high_priority',
                name: 'High Priority',
                condition: 'step_set_priority.priority == "high"',
                steps: [
                  {
                    stepId: 'step_handle_high',
                    stepType: 'tool_call',
                    name: 'Handle High',
                    config: { toolName: 'handle_high' },
                  },
                ],
              },
              {
                branchId: 'low_priority',
                name: 'Low Priority',
                condition: 'step_set_priority.priority == "low"',
                steps: [
                  {
                    stepId: 'step_handle_low',
                    stepType: 'tool_call',
                    name: 'Handle Low',
                    config: { toolName: 'handle_low' },
                  },
                ],
              },
            ],
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Branch Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues).toHaveLength(0);

      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_001',
      });

      const firstStepRunId = result.stepRuns.find(sr => sr.stepId === 'step_set_priority')?.stepRunId;

      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { priority: 'high' },
      });

      const afterBranchRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(afterBranchRun?.currentStepIds).toContain('step_handle_high');

      const lowPriorityStepRun = afterBranchRun?.stepRuns.find(sr => sr.stepId === 'step_handle_low');
      expect(lowPriorityStepRun?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED);

      const events = eventStore.query({ eventType: 'workflow_step_skipped' });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should select first branch when no condition matches', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_set_data',
          stepType: 'tool_call',
          name: 'Set Data',
          config: { toolName: 'set_data' },
          nextStepId: 'step_branch',
        },
        {
          stepId: 'step_branch',
          stepType: 'branch',
          name: 'Default Branch',
          config: {
            branches: [
              {
                branchId: 'default_branch',
                name: 'Default',
                steps: [
                  {
                    stepId: 'step_default',
                    stepType: 'tool_call',
                    name: 'Default Handler',
                    config: { toolName: 'handle_default' },
                  },
                ],
              },
            ],
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Default Branch Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_001',
      });

      const firstStepRunId = result.stepRuns.find(sr => sr.stepId === 'step_set_data')?.stepRunId;

      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { data: 'test' },
      });

      const afterBranchRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(afterBranchRun?.currentStepIds).toContain('step_default');
    });
  });

  describe('Condition Step Validation', () => {
    it('should validate condition step requires conditionExpression', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_condition',
          stepType: 'condition',
          name: 'Invalid Condition',
          config: {
            trueNextStepId: 'step_true',
          },
        },
        {
          stepId: 'step_true',
          stepType: 'tool_call',
          name: 'True Branch',
          config: { toolName: 'handle_true' },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Condition Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues.some(i => i.code === 'MISSING_CONDITION_EXPRESSION')).toBe(true);
    });

    it('should validate branch step requires branches', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_branch',
          stepType: 'branch',
          name: 'Invalid Branch',
          config: {},
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Branch Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues.some(i => i.code === 'MISSING_BRANCHES')).toBe(true);
    });

    it('should validate parallel_group step requires parallelSteps', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_parallel',
          stepType: 'parallel_group',
          name: 'Invalid Parallel',
          config: {},
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Parallel Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues.some(i => i.code === 'MISSING_PARALLEL_STEPS')).toBe(true);
    });
  });
});
