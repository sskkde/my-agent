import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createWorkflowDraftStore, type WorkflowDraftStore } from '../../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore, type WorkflowDefinitionStore } from '../../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore, type WorkflowRunStore } from '../../../src/storage/workflow-run-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { WORKFLOW_RUN_STATES, RUNTIME_ACTION_STATES } from '../../../src/shared/states.js';
import {
  createWorkflowRuntime,
  type WorkflowRuntime,
} from '../../../src/workflows/workflow-runtime.js';
import type {
  WorkflowStep,
} from '../../../src/workflows/types.js';

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
    `,
    down: `DROP TABLE IF EXISTS workflow_drafts;`
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
    `,
    down: `DROP TABLE IF EXISTS workflow_definitions;`
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
    `,
    down: `DROP TABLE IF EXISTS workflow_runs;`
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
    `,
    down: `DROP TABLE IF EXISTS workflow_step_runs;`
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
    `,
    down: `DROP TABLE IF EXISTS runtime_actions;`
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
    `,
    down: `DROP TABLE IF EXISTS events;`
  },
];

describe('Workflow Approval Policy Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let draftStore: WorkflowDraftStore;
  let definitionStore: WorkflowDefinitionStore;
  let workflowRunStore: WorkflowRunStore;
  let runtimeActionStore: RuntimeActionStore;
  let eventStore: EventStore;
  let workflowRuntime: WorkflowRuntime;
  let allRuntimes: WorkflowRuntime[] = [];

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
    allRuntimes = [];

    workflowRuntime = createWorkflowRuntime({
      draftStore,
      definitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
    });
    allRuntimes.push(workflowRuntime);
  });

  afterEach(() => {
    for (const rt of allRuntimes) {
      rt.shutdown();
    }
    connection?.close();
  });

  it('should create an approval runtime action targeting permission_engine', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'approval_001',
        stepType: 'approval',
        name: 'Manager Approval',
        description: 'Requires manager approval',
        config: {
          approvalScope: 'publish_release',
        },
        nextStepId: 'step_002',
      },
      {
        stepId: 'step_002',
        stepType: 'tool_call',
        name: 'Deploy',
        config: { toolName: 'deploy_tool' },
      },
    ];

    const draft = workflowRuntime.createDraft({
      name: 'Approval Workflow',
      steps,
      ownerUserId: 'user_001',
    });
    workflowRuntime.validateDraft(draft.draftId);
    const definition = workflowRuntime.publishDraft(draft.draftId);

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_001',
    });

    // Verify step runs include the approval step
    const approvalStepRun = result.stepRuns.find(sr => sr.stepType === 'approval');
    expect(approvalStepRun).toBeDefined();
    expect(approvalStepRun?.stepId).toBe('approval_001');
    expect(result.currentStepIds).toContain('approval_001');

    // Verify a RuntimeAction was created for the approval step
    const actions = runtimeActionStore.query({ workflowRunId: result.workflowRunId });
    expect(actions.length).toBeGreaterThan(0);

    const approvalAction = actions.find(a => a.targetAction === 'request_approval');
    expect(approvalAction).toBeDefined();
    expect(approvalAction?.targetRuntime).toBe('permission_engine');
    expect(approvalAction?.userId).toBe('user_001');
    expect(approvalAction?.status).toBe(RUNTIME_ACTION_STATES.CREATED);
  });

  it('should advance to next step when approval is granted', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'approval_001',
        stepType: 'approval',
        name: 'Approval Gate',
        config: {
          approvalScope: 'deploy_app',
        },
        nextStepId: 'step_deploy',
      },
      {
        stepId: 'step_deploy',
        stepType: 'tool_call',
        name: 'Deploy Step',
        config: { toolName: 'deploy_tool' },
      },
    ];

    const draft = workflowRuntime.createDraft({
      name: 'Approval Gate Workflow',
      steps,
      ownerUserId: 'user_002',
    });
    workflowRuntime.validateDraft(draft.draftId);
    const definition = workflowRuntime.publishDraft(draft.draftId);

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_002',
    });

    // Get the approval step run ID
    const approvalStepRun = result.stepRuns.find(sr => sr.stepId === 'approval_001');
    expect(approvalStepRun).toBeDefined();

    // Simulate approval being granted (successful completion)
    workflowRuntime.handleStepCompletion(approvalStepRun!.stepRunId, {
      success: true,
      output: { approved: true, approvedBy: 'manager_1' },
    });

    // Workflow should advance to deploy step
    const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
    expect(updatedRun?.currentStepIds).toContain('step_deploy');

    // Approval step should be marked completed
    const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);
    const approvalStep = stepRuns.find(sr => sr.stepId === 'approval_001');
    expect(approvalStep?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED);
  });

  it('should handle approval rejection correctly', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'approval_reject',
        stepType: 'approval',
        name: 'Rejectable Approval',
        config: {
          approvalScope: 'sensitive_operation',
          onFailure: 'fail',
        },
      },
    ];

    const draft = workflowRuntime.createDraft({
      name: 'Rejection Workflow',
      steps,
      ownerUserId: 'user_003',
    });
    workflowRuntime.validateDraft(draft.draftId);
    const definition = workflowRuntime.publishDraft(draft.draftId);

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_003',
    });

    const approvalStepRun = result.stepRuns.find(sr => sr.stepId === 'approval_reject');
    expect(approvalStepRun).toBeDefined();

    // Simulate rejection (failure)
    workflowRuntime.handleStepCompletion(approvalStepRun!.stepRunId, {
      success: false,
      error: 'Approval rejected by manager',
      errorCategory: 'permission_error',
      recoverability: 'non_recoverable',
    });

    // Workflow should be failed due to onFailure=fail
    const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
    expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED);

    // Step should be marked failed
    const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);
    const rejectedStep = stepRuns.find(sr => sr.stepId === 'approval_reject');
    expect(rejectedStep?.status).toBe(WORKFLOW_RUN_STATES.FAILED);
  });

  it('should continue on approval rejection when onFailure is continue', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'soft_approval',
        stepType: 'approval',
        name: 'Soft Approval',
        config: {
          approvalScope: 'advisory_review',
          onFailure: 'continue',
        },
        nextStepId: 'step_next',
      },
      {
        stepId: 'step_next',
        stepType: 'tool_call',
        name: 'Next Step After Approval',
        config: { toolName: 'process_tool' },
      },
    ];

    const draft = workflowRuntime.createDraft({
      name: 'Soft Approval Workflow',
      steps,
      ownerUserId: 'user_004',
    });
    workflowRuntime.validateDraft(draft.draftId);
    const definition = workflowRuntime.publishDraft(draft.draftId);

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_004',
    });

    const approvalStepRun = result.stepRuns.find(sr => sr.stepId === 'soft_approval');
    expect(approvalStepRun).toBeDefined();

    // Simulate rejection with continue policy
    workflowRuntime.handleStepCompletion(approvalStepRun!.stepRunId, {
      success: false,
      error: 'Advisory review declined',
      errorCategory: 'permission_error',
      recoverability: 'non_recoverable',
    });

    // Workflow should continue to next step
    const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
    expect(updatedRun?.currentStepIds).toContain('step_next');

    // Soft approval step should be marked completed (not failed) since onFailure=continue
    const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId);
    const softStep = stepRuns.find(sr => sr.stepId === 'soft_approval');
    expect(softStep?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED);
  });

  it('should properly set input data with approval scope', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'data_approval',
        stepType: 'approval',
        name: 'Data Access Approval',
        config: {
          approvalScope: 'access_sensitive_data',
        },
      },
    ];

    const draft = workflowRuntime.createDraft({
      name: 'Data Approval Workflow',
      steps,
      ownerUserId: 'user_005',
    });
    workflowRuntime.validateDraft(draft.draftId);
    const definition = workflowRuntime.publishDraft(draft.draftId);

    workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_005',
      inputData: { resourceId: 'res_123' },
    });

    // Query by workflow definition to find the run
    const workflowRuns = workflowRunStore.getWorkflowRunsByWorkflow(definition.workflowId);
    expect(workflowRuns.length).toBe(1);

    const allStepRuns = workflowRunStore.getStepsByWorkflowRunId(workflowRuns[0]!.workflowRunId);
    const approvalStep = allStepRuns.find(sr => sr.stepId === 'data_approval');
    expect(approvalStep).toBeDefined();

    const inputData = typeof approvalStep!.inputData === 'string'
      ? JSON.parse(approvalStep!.inputData)
      : approvalStep!.inputData;

    expect(inputData).toHaveProperty('approvalScope', 'access_sensitive_data');
    expect(inputData).toHaveProperty('resourceId', 'res_123');
  });
});
