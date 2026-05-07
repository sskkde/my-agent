/**
 * Plan-to-Workflow Integration Tests
 *
 * Tests the minimum end-to-end path that converts a plan-like structure
 * into a workflow draft/definition and allows validation/publish/run
 * through the existing workflow runtime.
 *
 * This is the "PlanToWorkflowCompiler" path mentioned in the architecture doc:
 * - Planner generates ExecutionPlan
 * - PlanToWorkflowCompiler converts to WorkflowDraft
 * - Workflow Runtime validates, publishes, and runs
 */

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
import type { WorkflowDraft } from '../../../src/workflows/types.js';
import {
  compilePlanToWorkflowDraft,
  type PlanToWorkflowInput,
} from '../../../src/workflows/plan-to-workflow-compiler.js';

function compileAndCreateDraft(
  plan: PlanToWorkflowInput,
  workflowRuntime: WorkflowRuntime
): WorkflowDraft {
  const result = compilePlanToWorkflowDraft(plan);
  if (!result.success) {
    throw new Error(`Compilation failed: ${result.errors.map(e => e.message).join(', ')}`);
  }
  return workflowRuntime.createDraft(result.payload);
}

// ============================================================================
// Migrations (copied from workflow-runtime.test.ts)
// ============================================================================

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
        updated_at TEXT NOT NULL
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
        updated_at TEXT NOT NULL
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
        updated_at TEXT NOT NULL
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
        created_at TEXT NOT NULL
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

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a valid plan-like input for testing.
 */
function createValidPlanInput(): PlanToWorkflowInput {
  return {
    planId: 'plan_001',
    name: 'Data Processing Pipeline',
    description: 'A workflow to process and validate data',
    ownerUserId: 'user_plan_001',
    steps: [
      {
        stepId: 'step_fetch',
        title: 'Fetch Data',
        description: 'Fetch data from source',
        stepType: 'tool_call',
        config: {
          toolName: 'fetch_data',
          toolParams: { source: 'api_endpoint' },
        },
        nextStepId: 'step_validate',
      },
      {
        stepId: 'step_validate',
        title: 'Validate Data',
        description: 'Validate the fetched data',
        stepType: 'tool_call',
        config: {
          toolName: 'validate_data',
          toolParams: { schema: 'data_schema_v1' },
        },
        nextStepId: 'step_process',
      },
      {
        stepId: 'step_process',
        title: 'Process Data',
        description: 'Process validated data with agent',
        stepType: 'agent_run',
        config: {
          agentId: 'data_processor_agent',
          agentParams: { mode: 'batch' },
        },
      },
    ],
    metadata: {
      source: 'planner',
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Creates an invalid plan-like input for testing validation.
 */
function createInvalidPlanInput(): PlanToWorkflowInput {
  return {
    planId: 'plan_invalid',
    name: 'Invalid Workflow',
    ownerUserId: 'user_plan_002',
    steps: [
      {
        stepId: 'step_001',
        title: 'Missing Tool Name',
        stepType: 'tool_call',
        config: {
          toolParams: { param: 'value' },
        },
        nextStepId: 'nonexistent_step',
      },
      {
        stepId: 'step_002',
        title: 'Invalid Step Type',
        stepType: 'invalid_type',
        config: {},
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Plan-to-Workflow Integration', () => {
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

  describe('Step 1: Create Workflow Draft from Plan', () => {
    it('should convert a valid plan-like input to a workflow draft', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      // Verify draft was created
      expect(draft.draftId).toBeDefined();
      expect(draft.name).toBe('Data Processing Pipeline');
      expect(draft.description).toBe('A workflow to process and validate data');
      expect(draft.ownerUserId).toBe('user_plan_001');
      expect(draft.status).toBe('draft');
      expect(draft.steps).toHaveLength(3);

      // Verify steps were converted correctly
      expect(draft.steps[0]?.stepId).toBe('step_fetch');
      expect(draft.steps[0]?.stepType).toBe('tool_call');
      expect(draft.steps[0]?.name).toBe('Fetch Data');
      expect(draft.steps[0]?.config.toolName).toBe('fetch_data');

      expect(draft.steps[1]?.stepId).toBe('step_validate');
      expect(draft.steps[1]?.stepType).toBe('tool_call');

      expect(draft.steps[2]?.stepId).toBe('step_process');
      expect(draft.steps[2]?.stepType).toBe('agent_run');
    });

    it('should persist the draft in the store', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      const retrieved = draftStore.getDraftById(draft.draftId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Data Processing Pipeline');
      expect(retrieved?.steps).toHaveLength(3);
    });

    it('should emit workflow_draft_created event', () => {
      const planInput = createValidPlanInput();
      compileAndCreateDraft(planInput, workflowRuntime);

      const events = eventStore.query({ eventType: 'workflow_draft_created' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload.name).toBe('Data Processing Pipeline');
    });
  });

  describe('Step 2: Validate Draft', () => {
    it('should validate a valid draft without issues', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues).toHaveLength(0);

      const updatedDraft = draftStore.getDraftById(draft.draftId);
      expect(updatedDraft?.status).toBe('draft');
      expect(updatedDraft?.validationIssues).toHaveLength(0);
    });

    it('should detect validation issues in an invalid draft', () => {
      const planInput = createInvalidPlanInput();
      const result = compilePlanToWorkflowDraft(planInput);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.code === 'MISSING_TOOL_NAME')).toBe(true);
      expect(result.errors.some(e => e.code === 'UNSUPPORTED_STEP_TYPE')).toBe(true);
      expect(result.errors.some(e => e.code === 'INVALID_NEXT_STEP_ID')).toBe(true);
    });

    it('should emit workflow_draft_validated event', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);

      const events = eventStore.query({ eventType: 'workflow_draft_validated' });
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Step 3: Publish Draft as Definition', () => {
    it('should publish a valid draft as a workflow definition', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      // Verify definition was created
      expect(definition.workflowId).toBeDefined();
      expect(definition.name).toBe('Data Processing Pipeline');
      expect(definition.description).toBe('A workflow to process and validate data');
      expect(definition.version).toBe(1);
      expect(definition.steps).toHaveLength(3);
      expect(definition.ownerUserId).toBe('user_plan_001');
      expect(definition.status).toBe('published');
      expect(definition.publishedFromDraftId).toBe(draft.draftId);
    });

    it('should persist the definition in the store', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const retrieved = definitionStore.getDefinitionById(definition.workflowId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Data Processing Pipeline');
      expect(retrieved?.status).toBe('published');
    });

    it('should reject invalid plans before publishing', () => {
      const planInput = createInvalidPlanInput();
      const result = compilePlanToWorkflowDraft(planInput);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_TOOL_NAME')).toBe(true);
      expect(result.errors.some(e => e.code === 'UNSUPPORTED_STEP_TYPE')).toBe(true);
      expect(result.errors.some(e => e.code === 'INVALID_NEXT_STEP_ID')).toBe(true);
    });

    it('should emit workflow_definition_published event', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      workflowRuntime.publishDraft(draft.draftId);

      const events = eventStore.query({ eventType: 'workflow_definition_published' });
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Step 4: Run Published Definition', () => {
    it('should start a workflow run from a published definition', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_001',
        sessionId: 'session_plan_001',
        inputData: { batchId: 'batch_123' },
      });

      // Verify run was started
      expect(result.workflowRunId).toBeDefined();
      expect(result.definitionId).toBe(definition.workflowId);
      expect(result.version).toBe(1);
      expect(result.status).toBe(WORKFLOW_RUN_STATES.RUNNING);
      expect(result.currentStepIds).toContain('step_fetch');
      expect(result.stepRuns).toHaveLength(3);
    });

    it('should persist the workflow run in the store', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_001',
      });

      const run = workflowRunStore.getWorkflowRunById(result.workflowRunId);
      expect(run).not.toBeNull();
      expect(run?.workflowId).toBe(definition.workflowId);
      expect(run?.status).toBe(WORKFLOW_RUN_STATES.RUNNING);
    });

    it('should create step runs for all workflow steps', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_001',
      });

      const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);
      expect(stepRuns).toHaveLength(3);
      expect(stepRuns.map(sr => sr.stepId)).toContain('step_fetch');
      expect(stepRuns.map(sr => sr.stepId)).toContain('step_validate');
      expect(stepRuns.map(sr => sr.stepId)).toContain('step_process');
    });

    it('should emit workflow_run_started event', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_001',
      });

      const events = eventStore.query({ eventType: 'workflow_run_started' });
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Step 5: Complete WorkflowRun', () => {
    it('should complete workflow when all steps finish successfully', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_001',
      });

      // Complete first step
      const firstStepRunId = result.stepRuns[0]?.stepRunId;
      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: true,
        output: { data: 'fetched_data' },
      });

      // Verify advanced to second step
      let run = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(run?.currentStepIds).toContain('step_validate');

      // Complete second step
      const secondStepRunId = result.stepRuns[1]?.stepRunId;
      workflowRuntime.handleStepCompletion(secondStepRunId!, {
        success: true,
        output: { valid: true },
      });

      // Verify advanced to third step
      run = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(run?.currentStepIds).toContain('step_process');

      // Complete third step (final)
      const thirdStepRunId = result.stepRuns[2]?.stepRunId;
      workflowRuntime.handleStepCompletion(thirdStepRunId!, {
        success: true,
        output: { processed: true },
      });

      // Verify workflow completed
      run = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(run?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED);
    });

    it('should emit workflow_run_completed event when workflow finishes', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_001',
      });

      // Complete all steps
      for (const stepRun of result.stepRuns) {
        workflowRuntime.handleStepCompletion(stepRun.stepRunId, {
          success: true,
          output: { done: true },
        });
      }

      const events = eventStore.query({ eventType: 'workflow_run_completed' });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should fail workflow when a step fails and onFailure is fail_workflow', () => {
      const planInput: PlanToWorkflowInput = {
        planId: 'plan_fail',
        name: 'Failing Workflow',
        ownerUserId: 'user_plan_003',
        steps: [
          {
            stepId: 'step_001',
            title: 'Will Fail',
            stepType: 'tool_call',
            config: {
              toolName: 'failing_tool',
              onFailure: 'fail_workflow',
            },
          },
        ],
      };

      const draft = compileAndCreateDraft(planInput, workflowRuntime);
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_003',
      });

      const stepRunId = result.stepRuns[0]?.stepRunId;
      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Tool execution failed',
      });

      const run = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(run?.status).toBe(WORKFLOW_RUN_STATES.FAILED);
    });

    it('should continue workflow when step fails and onFailure is continue', () => {
      const planInput: PlanToWorkflowInput = {
        planId: 'plan_continue',
        name: 'Continue On Failure',
        ownerUserId: 'user_plan_004',
        steps: [
          {
            stepId: 'step_001',
            title: 'Will Fail But Continue',
            stepType: 'tool_call',
            config: {
              toolName: 'failing_tool',
              onFailure: 'continue',
            },
            nextStepId: 'step_002',
          },
          {
            stepId: 'step_002',
            title: 'Next Step',
            stepType: 'tool_call',
            config: {
              toolName: 'next_tool',
            },
          },
        ],
      };

      const draft = compileAndCreateDraft(planInput, workflowRuntime);
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_004',
      });

      const firstStepRunId = result.stepRuns[0]?.stepRunId;
      workflowRuntime.handleStepCompletion(firstStepRunId!, {
        success: false,
        error: 'Step failed but continuing',
      });

      const run = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(run?.currentStepIds).toContain('step_002');
    });
  });

  describe('End-to-End: Full Plan-to-Workflow Path', () => {
    it('should complete the full path: plan → draft → validate → publish → run → complete', () => {
      // Step 1: Create draft from plan
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);
      expect(draft.draftId).toBeDefined();
      expect(draft.status).toBe('draft');

      // Step 2: Validate draft
      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues).toHaveLength(0);

      // Step 3: Publish draft
      const definition = workflowRuntime.publishDraft(draft.draftId);
      expect(definition.workflowId).toBeDefined();
      expect(definition.status).toBe('published');

      // Step 4: Start workflow run
      const runResult = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: planInput.ownerUserId,
        inputData: { testRun: true },
      });
      expect(runResult.workflowRunId).toBeDefined();
      expect(runResult.status).toBe(WORKFLOW_RUN_STATES.RUNNING);

      // Step 5: Complete all steps
      for (const stepRun of runResult.stepRuns) {
        workflowRuntime.handleStepCompletion(stepRun.stepRunId, {
          success: true,
          output: { completed: stepRun.stepId },
        });
      }

      // Verify final state
      const finalRun = workflowRuntime.getWorkflowRun(runResult.workflowRunId);
      expect(finalRun?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED);

      // Verify all events were emitted
      const createdEvents = eventStore.query({ eventType: 'workflow_draft_created' });
      const validatedEvents = eventStore.query({ eventType: 'workflow_draft_validated' });
      const publishedEvents = eventStore.query({ eventType: 'workflow_definition_published' });
      const startedEvents = eventStore.query({ eventType: 'workflow_run_started' });
      const completedEvents = eventStore.query({ eventType: 'workflow_run_completed' });

      expect(createdEvents.length).toBeGreaterThan(0);
      expect(validatedEvents.length).toBeGreaterThan(0);
      expect(publishedEvents.length).toBeGreaterThan(0);
      expect(startedEvents.length).toBeGreaterThan(0);
      expect(completedEvents.length).toBeGreaterThan(0);
    });

    it('should handle cancellation at any stage', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_plan_001',
      });

      // Cancel the run
      workflowRuntime.cancelWorkflowRun(result.workflowRunId);

      const run = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(run?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED);

      // Verify all step runs are cancelled
      const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);
      expect(stepRuns.every(sr => sr.status === WORKFLOW_RUN_STATES.CANCELLED)).toBe(true);
    });
  });

  describe('Version Management', () => {
    it('should increment version when publishing same workflow name multiple times', () => {
      const planInput = createValidPlanInput();

      // First version
      const draft1 = compileAndCreateDraft(planInput, workflowRuntime);
      workflowRuntime.validateDraft(draft1.draftId);
      const def1 = workflowRuntime.publishDraft(draft1.draftId);

      // Second version (same name)
      const draft2 = compileAndCreateDraft(planInput, workflowRuntime);
      workflowRuntime.validateDraft(draft2.draftId);
      const def2 = workflowRuntime.publishDraft(draft2.draftId);

      expect(def1.version).toBe(1);
      expect(def2.version).toBe(2);
      expect(def1.name).toBe(def2.name);
    });

    it('should track which draft a definition was published from', () => {
      const planInput = createValidPlanInput();
      const draft = compileAndCreateDraft(planInput, workflowRuntime);
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      expect(definition.publishedFromDraftId).toBe(draft.draftId);
    });
  });
});
