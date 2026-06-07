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

describe('Workflow Version Compatibility', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let draftStore: WorkflowDraftStore
  let definitionStore: WorkflowDefinitionStore
  let workflowRunStore: WorkflowRunStore
  let runtimeActionStore: RuntimeActionStore
  let eventStore: EventStore
  let workflowRuntime: WorkflowRuntime

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

    workflowRuntime = createWorkflowRuntime({
      draftStore,
      definitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
    })
  })

  afterEach(() => {
    connection?.close()
  })

  it('should pin a workflow run to its definition version steps', () => {
    // Create v1 definition with step order A → B
    const v1Steps: WorkflowStep[] = [
      {
        stepId: 'step_a',
        stepType: 'tool_call',
        name: 'Step A',
        config: { toolName: 'tool_a' },
        nextStepId: 'step_b',
      },
      {
        stepId: 'step_b',
        stepType: 'tool_call',
        name: 'Step B',
        config: { toolName: 'tool_b' },
      },
    ]

    const v1Draft = workflowRuntime.createDraft({
      name: 'Versioned Workflow',
      description: 'Version compatibility test',
      steps: v1Steps,
      ownerUserId: 'user_001',
    })
    workflowRuntime.validateDraft(v1Draft.draftId)
    const v1Def = workflowRuntime.publishDraft(v1Draft.draftId)
    expect(v1Def.version).toBe(1)

    // Start a run with v1
    const v1Run = workflowRuntime.startWorkflowRun({
      definitionId: v1Def.workflowId,
      userId: 'user_001',
    })

    // Verify v1 run uses v1 steps
    expect(v1Run.version).toBe(1)
    expect(v1Run.currentStepIds).toContain('step_a')
    expect(v1Run.stepRuns).toHaveLength(2)
    const v1RunStepIds = v1Run.stepRuns.map((sr) => sr.stepId).sort()
    expect(v1RunStepIds).toEqual(['step_a', 'step_b'])

    // Publish v2 definition with different step order C → D
    const v2Steps: WorkflowStep[] = [
      {
        stepId: 'step_c',
        stepType: 'tool_call',
        name: 'Step C',
        config: { toolName: 'tool_c' },
        nextStepId: 'step_d',
      },
      {
        stepId: 'step_d',
        stepType: 'tool_call',
        name: 'Step D',
        config: { toolName: 'tool_d' },
      },
    ]

    const v2Draft = workflowRuntime.createDraft({
      name: 'Versioned Workflow',
      steps: v2Steps,
      ownerUserId: 'user_001',
    })
    workflowRuntime.validateDraft(v2Draft.draftId)
    const v2Def = workflowRuntime.publishDraft(v2Draft.draftId)
    expect(v2Def.version).toBe(2)
    // Verify v1 and v2 have different definition IDs
    expect(v2Def.workflowId).not.toBe(v1Def.workflowId)

    // The running v1 run should still use v1 steps (not switch to v2)
    const v1RunAfterV2 = workflowRuntime.getWorkflowRun(v1Run.workflowRunId)
    expect(v1RunAfterV2).not.toBeNull()
    expect(v1RunAfterV2?.version).toBe(1)
    expect(v1RunAfterV2?.definitionId).toBe(v1Def.workflowId)
    const v1RunStepIdsAfterV2 = v1RunAfterV2!.stepRuns.map((sr) => sr.stepId).sort()
    expect(v1RunStepIdsAfterV2).toEqual(['step_a', 'step_b'])

    // Complete step_a → should advance to step_b (v1 step)
    const stepARun = v1Run.stepRuns.find((sr) => sr.stepId === 'step_a')
    expect(stepARun).toBeDefined()
    workflowRuntime.handleStepCompletion(stepARun!.stepRunId, {
      success: true,
      output: { result: 'a_done' },
    })

    const v1RunAfterAdvance = workflowRuntime.getWorkflowRun(v1Run.workflowRunId)
    expect(v1RunAfterAdvance?.currentStepIds).toContain('step_b')
    // Should NOT contain v2 steps
    expect(v1RunAfterAdvance?.currentStepIds).not.toContain('step_c')
    expect(v1RunAfterAdvance?.currentStepIds).not.toContain('step_d')
  })

  it('should start new runs with the latest definition version', () => {
    // Create v1
    const v1Steps: WorkflowStep[] = [
      {
        stepId: 'step_1',
        stepType: 'tool_call',
        name: 'Step 1 v1',
        config: { toolName: 'tool_1' },
      },
    ]

    const v1Draft = workflowRuntime.createDraft({
      name: 'New Version Workflow',
      steps: v1Steps,
      ownerUserId: 'user_002',
    })
    workflowRuntime.validateDraft(v1Draft.draftId)
    const v1Def = workflowRuntime.publishDraft(v1Draft.draftId)
    expect(v1Def.version).toBe(1)

    // Publish v2 with different steps
    const v2Steps: WorkflowStep[] = [
      {
        stepId: 'step_2',
        stepType: 'tool_call',
        name: 'Step 2 v2',
        config: { toolName: 'tool_2' },
      },
    ]

    const v2Draft = workflowRuntime.createDraft({
      name: 'New Version Workflow',
      steps: v2Steps,
      ownerUserId: 'user_002',
    })
    workflowRuntime.validateDraft(v2Draft.draftId)
    const v2Def = workflowRuntime.publishDraft(v2Draft.draftId)
    expect(v2Def.version).toBe(2)

    // Start a new run with v2
    const v2Run = workflowRuntime.startWorkflowRun({
      definitionId: v2Def.workflowId,
      userId: 'user_002',
    })

    expect(v2Run.version).toBe(2)
    expect(v2Run.definitionId).toBe(v2Def.workflowId)
    expect(v2Run.stepRuns).toHaveLength(1)
    expect(v2Run.stepRuns[0]?.stepId).toBe('step_2')
    expect(v2Run.currentStepIds).toContain('step_2')

    // Also verify we can still start runs from v1 definition
    const v1Run2 = workflowRuntime.startWorkflowRun({
      definitionId: v1Def.workflowId,
      userId: 'user_002',
    })

    expect(v1Run2.version).toBe(1)
    expect(v1Run2.definitionId).toBe(v1Def.workflowId)
    expect(v1Run2.stepRuns[0]?.stepId).toBe('step_1')
  })

  it('should persist version information in workflow run record', () => {
    const steps: WorkflowStep[] = [
      {
        stepId: 'step_x',
        stepType: 'tool_call',
        name: 'Step X',
        config: { toolName: 'tool_x' },
      },
    ]

    const draft = workflowRuntime.createDraft({
      name: 'Version Record Workflow',
      steps,
      ownerUserId: 'user_003',
    })
    workflowRuntime.validateDraft(draft.draftId)
    const definition = workflowRuntime.publishDraft(draft.draftId)

    const result = workflowRuntime.startWorkflowRun({
      definitionId: definition.workflowId,
      userId: 'user_003',
    })

    // Verify version is correctly recorded in the store
    const storedRun = workflowRunStore.getWorkflowRunById(result.workflowRunId)
    expect(storedRun).not.toBeNull()
    expect(storedRun?.workflowVersion).toBe(String(definition.version))
    expect(storedRun?.workflowId).toBe(definition.workflowId)

    // Verify getWorkflowRun returns correct version
    const retrieved = workflowRuntime.getWorkflowRun(result.workflowRunId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.version).toBe(definition.version)
    expect(retrieved?.definitionId).toBe(definition.workflowId)
  })
})
