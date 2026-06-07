import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js'
import { createWorkflowDraftStore, type WorkflowDraftStore } from '../../../src/storage/workflow-draft-store.js'
import {
  createWorkflowDefinitionStore,
  type WorkflowDefinitionStore,
} from '../../../src/storage/workflow-definition-store.js'
import { createWorkflowRunStore, type WorkflowRunStore } from '../../../src/storage/workflow-run-store.js'
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js'
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js'
import { WORKFLOW_RUN_STATES, RUNTIME_ACTION_STATES } from '../../../src/shared/states.js'
import { createWorkflowRuntime, type WorkflowRuntime } from '../../../src/workflows/workflow-runtime.js'
import type { WorkflowStep } from '../../../src/workflows/types.js'

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
    down: `DROP TABLE IF EXISTS workflow_drafts;`,
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
    down: `DROP TABLE IF EXISTS workflow_definitions;`,
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
    down: `DROP TABLE IF EXISTS workflow_runs;`,
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
    down: `DROP TABLE IF EXISTS workflow_step_runs;`,
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
    down: `DROP TABLE IF EXISTS runtime_actions;`,
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
    down: `DROP TABLE IF EXISTS events;`,
  },
]

describe('Workflow Cancel Cascade', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let draftStore: WorkflowDraftStore
  let definitionStore: WorkflowDefinitionStore
  let workflowRunStore: WorkflowRunStore
  let runtimeActionStore: RuntimeActionStore
  let eventStore: EventStore
  let workflowRuntime: WorkflowRuntime
  let allRuntimes: WorkflowRuntime[] = []

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(workflowRuntimeMigrations)

    draftStore = createWorkflowDraftStore(connection)
    definitionStore = createWorkflowDefinitionStore(connection)
    workflowRunStore = createWorkflowRunStore(connection)
    runtimeActionStore = createRuntimeActionStore(connection)
    eventStore = createEventStore(connection)
    allRuntimes = []

    workflowRuntime = createWorkflowRuntime({
      draftStore,
      definitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
    })
    allRuntimes.push(workflowRuntime)
  })

  afterEach(() => {
    for (const rt of allRuntimes) {
      rt.shutdown()
    }
    connection?.close()
  })

  it('should cancel all pending step runs when workflow run is cancelled', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'step_001',
        stepType: 'tool_call',
        name: 'Step 1',
        config: { toolName: 'tool_a' },
        nextStepId: 'step_002',
      },
      {
        stepId: 'step_002',
        stepType: 'tool_call',
        name: 'Step 2',
        config: { toolName: 'tool_b' },
        nextStepId: 'step_003',
      },
      {
        stepId: 'step_003',
        stepType: 'tool_call',
        name: 'Step 3',
        config: { toolName: 'tool_c' },
      },
    ]

    const draft = workflowRuntime.createDraft({
      name: 'Cancel Steps Workflow',
      steps,
      ownerUserId: 'user_001',
    })
    workflowRuntime.validateDraft(draft.draftId)
    const definition = workflowRuntime.publishDraft(draft.draftId)

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_001',
    })

    // Verify all 3 step runs were created
    expect(result.stepRuns).toHaveLength(3)

    // Cancel the workflow run
    workflowRuntime.cancelWorkflowRun(result.workflowRunId)

    // Verify the workflow run status is cancelled
    const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId)
    expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED)

    // Verify all step runs are cancelled
    const stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId)
    expect(stepRuns.length).toBe(3)
    for (const stepRun of stepRuns) {
      expect(stepRun.status).toBe(WORKFLOW_RUN_STATES.CANCELLED)
    }
  })

  it('should cancel all pending RuntimeActions when workflow run is cancelled', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'approval_step',
        stepType: 'approval',
        name: 'Requires Approval',
        config: {
          approvalScope: 'deploy_to_prod',
        },
        nextStepId: 'tool_step',
      },
      {
        stepId: 'tool_step',
        stepType: 'tool_call',
        name: 'Execute Action',
        config: { toolName: 'deploy_tool' },
      },
    ]

    const draft = workflowRuntime.createDraft({
      name: 'Cancel Actions Workflow',
      steps,
      ownerUserId: 'user_002',
    })
    workflowRuntime.validateDraft(draft.draftId)
    const definition = workflowRuntime.publishDraft(draft.draftId)

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_002',
    })

    // Verify RuntimeActions were created for the workflow run
    const actionsBeforeCancel = runtimeActionStore.query({ workflowRunId: result.workflowRunId })
    expect(actionsBeforeCancel.length).toBeGreaterThan(0)

    // Verify there are non-terminal actions
    const nonTerminalBefore = actionsBeforeCancel.filter(
      (a) =>
        a.status !== RUNTIME_ACTION_STATES.COMPLETED &&
        a.status !== RUNTIME_ACTION_STATES.FAILED &&
        a.status !== RUNTIME_ACTION_STATES.CANCELLED &&
        a.status !== RUNTIME_ACTION_STATES.TIMEOUT &&
        a.status !== RUNTIME_ACTION_STATES.DENIED,
    )
    expect(nonTerminalBefore.length).toBeGreaterThan(0)

    // Cancel the workflow run
    workflowRuntime.cancelWorkflowRun(result.workflowRunId)

    // Verify all runtime actions for this workflow are now cancelled
    const actionsAfterCancel = runtimeActionStore.query({ workflowRunId: result.workflowRunId })
    expect(actionsAfterCancel.length).toBeGreaterThan(0)

    for (const action of actionsAfterCancel) {
      if (
        action.status !== RUNTIME_ACTION_STATES.COMPLETED &&
        action.status !== RUNTIME_ACTION_STATES.FAILED &&
        action.status !== RUNTIME_ACTION_STATES.TIMEOUT &&
        action.status !== RUNTIME_ACTION_STATES.DENIED
      ) {
        expect(action.status).toBe(RUNTIME_ACTION_STATES.CANCELLED)
      }
    }
  })

  it('should emit cancel event with cascade counts', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'step_a',
        stepType: 'tool_call',
        name: 'Step A',
        config: { toolName: 'test_tool' },
        nextStepId: 'step_b',
      },
      {
        stepId: 'step_b',
        stepType: 'tool_call',
        name: 'Step B',
        config: { toolName: 'test_tool_2' },
      },
    ]

    const draft = workflowRuntime.createDraft({
      name: 'Cancel Event Workflow',
      steps,
      ownerUserId: 'user_003',
    })
    workflowRuntime.validateDraft(draft.draftId)
    const definition = workflowRuntime.publishDraft(draft.draftId)

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_003',
    })

    workflowRuntime.cancelWorkflowRun(result.workflowRunId)

    // Verify cancel event was emitted
    const cancelEvents = eventStore.query({ eventType: 'workflow_run_cancelled' })
    expect(cancelEvents.length).toBeGreaterThan(0)

    const cancelEvent = cancelEvents[0]
    expect(cancelEvent).toBeDefined()
    expect(cancelEvent?.payload).toHaveProperty('workflowRunId', result.workflowRunId)
    expect(cancelEvent?.payload).toHaveProperty('cancelledStepCount')
    expect(cancelEvent?.payload).toHaveProperty('cancelledActionCount')
    expect(cancelEvent?.payload).toHaveProperty('cancelledAt')
  })

  it('should not cancel already-completed steps', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'completed_step',
        stepType: 'tool_call',
        name: 'Completed Step',
        config: { toolName: 'test_tool' },
        nextStepId: 'pending_step',
      },
      {
        stepId: 'pending_step',
        stepType: 'tool_call',
        name: 'Pending Step',
        config: { toolName: 'test_tool_2' },
      },
    ]

    const draft = workflowRuntime.createDraft({
      name: 'Partial Cancel Workflow',
      steps,
      ownerUserId: 'user_004',
    })
    workflowRuntime.validateDraft(draft.draftId)
    const definition = workflowRuntime.publishDraft(draft.draftId)

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_004',
    })

    // Complete the first step
    const firstStepRun = result.stepRuns.find((sr) => sr.stepId === 'completed_step')
    expect(firstStepRun).toBeDefined()
    workflowRuntime.handleStepCompletion(firstStepRun!.stepRunId, {
      success: true,
      output: { result: 'done' },
    })

    // Verify first step is completed
    let stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId)
    const completedStep = stepRuns.find((sr) => sr.stepId === 'completed_step')
    expect(completedStep?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED)

    // Cancel the workflow (pending step should be cancelled, completed step should stay completed)
    workflowRuntime.cancelWorkflowRun(result.workflowRunId)

    stepRuns = workflowRunStore.getStepsByWorkflowRunId(result.workflowRunId)
    const completedStepAfter = stepRuns.find((sr) => sr.stepId === 'completed_step')
    const pendingStep = stepRuns.find((sr) => sr.stepId === 'pending_step')

    expect(completedStepAfter?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED)
    expect(pendingStep?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED)
  })

  it('should be idempotent - cancelling an already cancelled run should not throw', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'step_one',
        stepType: 'tool_call',
        name: 'Only Step',
        config: { toolName: 'test_tool' },
      },
    ]

    const draft = workflowRuntime.createDraft({
      name: 'Idempotent Cancel Workflow',
      steps,
      ownerUserId: 'user_005',
    })
    workflowRuntime.validateDraft(draft.draftId)
    const definition = workflowRuntime.publishDraft(draft.draftId)

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_005',
    })

    // First cancel
    workflowRuntime.cancelWorkflowRun(result.workflowRunId)

    // Verify cancelled
    let updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId)
    expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED)

    // Second cancel should not throw
    expect(() => {
      workflowRuntime.cancelWorkflowRun(result.workflowRunId)
    }).not.toThrow()

    // Status should remain cancelled
    updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId)
    expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED)
  })
})
