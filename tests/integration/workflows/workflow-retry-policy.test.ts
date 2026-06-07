import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { WORKFLOW_RUN_STATES } from '../../../src/shared/states.js'
import { createWorkflowRuntime, type WorkflowRuntime } from '../../../src/workflows/workflow-runtime.js'
import type { WorkflowStep } from '../../../src/workflows/types.js'
import { TestClock } from '../../helpers/clock.js'

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
      CREATE INDEX idx_workflow_defs_owner ON workflow_definitions(owner_user_id);
      CREATE INDEX idx_workflow_defs_status ON workflow_definitions(status);
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
      CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
      CREATE INDEX idx_workflow_runs_owner_status ON workflow_runs(owner_user_id, status);
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
      CREATE INDEX idx_workflow_step_runs_workflow_status ON workflow_step_runs(workflow_run_id, status);
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
      CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
      CREATE INDEX idx_runtime_actions_workflow_run ON runtime_actions(workflow_run_id);
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
      CREATE INDEX idx_events_type ON events(event_type);
      CREATE INDEX idx_events_correlation ON events(correlation_id);
    `,
    down: `DROP TABLE IF EXISTS events;`,
  },
]

describe('Workflow Retry Policy Integration', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let draftStore: WorkflowDraftStore
  let definitionStore: WorkflowDefinitionStore
  let workflowRunStore: WorkflowRunStore
  let runtimeActionStore: RuntimeActionStore
  let eventStore: EventStore
  let workflowRuntime: WorkflowRuntime
  let clock: TestClock
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
    clock = new TestClock('2024-01-01T00:00:00.000Z')
    allRuntimes = []

    workflowRuntime = createWorkflowRuntime({
      draftStore,
      definitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
      clock: {
        now: () => clock.now(),
        nowISO: () => clock.nowISO(),
        advance: (ms: number) => clock.advance(ms),
      },
    })
    allRuntimes.push(workflowRuntime)
  })

  afterEach(() => {
    for (const rt of allRuntimes) {
      rt.shutdown()
    }
    connection?.close()
  })

  describe('Retry Policy V2', () => {
    it('should retry step on retryable error up to maxAttempts', async () => {
      let attemptCount = 0
      const mockDispatcher = {
        dispatch: vi.fn().mockImplementation(async () => {
          attemptCount++
          if (attemptCount < 2) {
            return { success: false, error: 'Temporary failure' }
          }
          return { success: true, result: { data: 'success' } }
        }),
      }

      const workflowRuntimeWithDispatcher = createWorkflowRuntime({
        draftStore,
        definitionStore,
        workflowRunStore,
        runtimeActionStore,
        eventStore,
        clock: {
          now: () => clock.now(),
          nowISO: () => clock.nowISO(),
          advance: (ms: number) => clock.advance(ms),
        },
        dispatcher: mockDispatcher,
      })
      allRuntimes.push(workflowRuntimeWithDispatcher)

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Retryable Step',
          config: {
            toolName: 'test_tool',
            retryPolicyV2: {
              maxAttempts: 3,
              backoff: 'fixed',
              initialDelayMs: 100,
              retryableErrorCategories: ['timeout'],
            },
            onFailure: 'fail',
          },
        },
      ]

      const draft = workflowRuntimeWithDispatcher.createDraft({
        name: 'Retry Test Workflow',
        steps,
        ownerUserId: 'user_001',
      })
      workflowRuntimeWithDispatcher.validateDraft(draft.draftId)
      const definition = workflowRuntimeWithDispatcher.publishDraft(draft.draftId)

      const result = workflowRuntimeWithDispatcher.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_001',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId
      expect(stepRunId).toBeDefined()

      await new Promise((resolve) => setTimeout(resolve, 50))

      workflowRuntimeWithDispatcher.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Timeout occurred',
        errorCategory: 'timeout',
        recoverability: 'retryable_later',
      })

      await new Promise((resolve) => setTimeout(resolve, 250))

      const events = eventStore.query({ eventType: 'workflow_step_retry_scheduled' })
      expect(events.length).toBeGreaterThan(0)
    })

    it('should fail after maxAttempts exceeded', async () => {
      let attemptCount = 0
      const mockDispatcher = {
        dispatch: vi.fn().mockImplementation(async () => {
          attemptCount++
          return { success: false, error: 'Permanent failure' }
        }),
      }

      const workflowRuntimeWithDispatcher = createWorkflowRuntime({
        draftStore,
        definitionStore,
        workflowRunStore,
        runtimeActionStore,
        eventStore,
        clock: {
          now: () => clock.now(),
          nowISO: () => clock.nowISO(),
          advance: (ms: number) => clock.advance(ms),
        },
        dispatcher: mockDispatcher,
      })
      allRuntimes.push(workflowRuntimeWithDispatcher)

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Failing Step',
          config: {
            toolName: 'test_tool',
            retryPolicyV2: {
              maxAttempts: 2,
              backoff: 'none',
              retryableErrorCategories: ['timeout'],
            },
            onFailure: 'fail',
          },
        },
      ]

      const draft = workflowRuntimeWithDispatcher.createDraft({
        name: 'Max Attempts Workflow',
        steps,
        ownerUserId: 'user_002',
      })
      workflowRuntimeWithDispatcher.validateDraft(draft.draftId)
      const definition = workflowRuntimeWithDispatcher.publishDraft(draft.draftId)

      const result = workflowRuntimeWithDispatcher.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_002',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntimeWithDispatcher.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Timeout',
        errorCategory: 'timeout',
        recoverability: 'retryable_later',
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      workflowRuntimeWithDispatcher.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Timeout again',
        errorCategory: 'timeout',
        recoverability: 'retryable_later',
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const updatedRun = workflowRuntimeWithDispatcher.getWorkflowRun(result.workflowRunId)
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED)
    })

    it('should not retry non-retryable errors', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Non-retryable Step',
          config: {
            toolName: 'test_tool',
            retryPolicyV2: {
              maxAttempts: 3,
              backoff: 'fixed',
              initialDelayMs: 100,
              retryableErrorCategories: ['timeout'],
            },
            onFailure: 'fail',
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Non-retryable Workflow',
        steps,
        ownerUserId: 'user_003',
      })
      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_003',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Permission denied',
        errorCategory: 'permission_error',
        recoverability: 'non_recoverable',
      })

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId)
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED)

      const retryEvents = eventStore.query({ eventType: 'workflow_step_retry_scheduled' })
      expect(retryEvents.length).toBe(0)
    })
  })

  describe('OnFailure Policies', () => {
    it('should fail workflow when onFailure is fail', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Fail Step',
          config: {
            toolName: 'test_tool',
            onFailure: 'fail',
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Fail Policy Workflow',
        steps,
        ownerUserId: 'user_004',
      })
      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_004',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Step failed',
      })

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId)
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED)

      const stepRun = workflowRunStore.getStepRunById(stepRunId!)
      expect(stepRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED)
    })

    it('should continue to next step when onFailure is continue', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Continue Step',
          config: {
            toolName: 'test_tool',
            onFailure: 'continue',
          },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Next Step',
          config: {
            toolName: 'test_tool2',
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Continue Policy Workflow',
        steps,
        ownerUserId: 'user_005',
      })
      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_005',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Step failed but continuing',
      })

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId)
      expect(updatedRun?.currentStepIds).toContain('step_002')

      const stepRun = workflowRunStore.getStepRunById(stepRunId!)
      expect(stepRun?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED)

      const continueEvents = eventStore.query({ eventType: 'workflow_step_failed_continue' })
      expect(continueEvents.length).toBeGreaterThan(0)
    })

    it('should skip step when onFailure is skip', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Skip Step',
          config: {
            toolName: 'test_tool',
            onFailure: 'skip',
          },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Next Step',
          config: {
            toolName: 'test_tool2',
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Skip Policy Workflow',
        steps,
        ownerUserId: 'user_006',
      })
      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_006',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Step failed and skipped',
      })

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId)
      expect(updatedRun?.currentStepIds).toContain('step_002')

      const stepRun = workflowRunStore.getStepRunById(stepRunId!)
      expect(stepRun?.status).toBe(WORKFLOW_RUN_STATES.CANCELLED)

      const skipEvents = eventStore.query({ eventType: 'workflow_step_skipped' })
      expect(skipEvents.length).toBeGreaterThan(0)
    })

    it('should call compensate hook when onFailure is compensate', async () => {
      const mockDispatcher = {
        dispatch: vi.fn().mockResolvedValue({ success: true, result: { compensated: true } }),
      }

      const workflowRuntimeWithDispatcher = createWorkflowRuntime({
        draftStore,
        definitionStore,
        workflowRunStore,
        runtimeActionStore,
        eventStore,
        clock: {
          now: () => clock.now(),
          nowISO: () => clock.nowISO(),
          advance: (ms: number) => clock.advance(ms),
        },
        dispatcher: mockDispatcher,
      })
      allRuntimes.push(workflowRuntimeWithDispatcher)

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Compensate Step',
          config: {
            toolName: 'test_tool',
            onFailure: 'compensate',
            compensateHook: 'rollback_transaction',
          },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Next Step',
          config: {
            toolName: 'test_tool2',
          },
        },
      ]

      const draft = workflowRuntimeWithDispatcher.createDraft({
        name: 'Compensate Policy Workflow',
        steps,
        ownerUserId: 'user_007',
      })
      workflowRuntimeWithDispatcher.validateDraft(draft.draftId)
      const definition = workflowRuntimeWithDispatcher.publishDraft(draft.draftId)

      const result = workflowRuntimeWithDispatcher.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_007',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntimeWithDispatcher.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Step failed, compensating',
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          targetAction: 'execute_compensate_hook',
          payload: expect.objectContaining({
            compensateHook: 'rollback_transaction',
          }),
        }),
      )

      const compensateEvents = eventStore.query({ eventType: 'workflow_step_compensate_requested' })
      expect(compensateEvents.length).toBeGreaterThan(0)
    })

    it('should fail if compensate hook fails', async () => {
      const mockDispatcher = {
        dispatch: vi.fn().mockResolvedValue({ success: false, error: 'Compensation failed' }),
      }

      const workflowRuntimeWithDispatcher = createWorkflowRuntime({
        draftStore,
        definitionStore,
        workflowRunStore,
        runtimeActionStore,
        eventStore,
        clock: {
          now: () => clock.now(),
          nowISO: () => clock.nowISO(),
          advance: (ms: number) => clock.advance(ms),
        },
        dispatcher: mockDispatcher,
      })
      allRuntimes.push(workflowRuntimeWithDispatcher)

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Compensate Fail Step',
          config: {
            toolName: 'test_tool',
            onFailure: 'compensate',
            compensateHook: 'failing_compensate',
          },
        },
      ]

      const draft = workflowRuntimeWithDispatcher.createDraft({
        name: 'Compensate Fail Workflow',
        steps,
        ownerUserId: 'user_008',
      })
      workflowRuntimeWithDispatcher.validateDraft(draft.draftId)
      const definition = workflowRuntimeWithDispatcher.publishDraft(draft.draftId)

      const result = workflowRuntimeWithDispatcher.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_008',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntimeWithDispatcher.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'Step failed',
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const updatedRun = workflowRuntimeWithDispatcher.getWorkflowRun(result.workflowRunId)
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED)
    })
  })

  describe('Backoff Strategies', () => {
    it('should use exponential backoff', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Exponential Backoff Step',
          config: {
            toolName: 'test_tool',
            retryPolicyV2: {
              maxAttempts: 4,
              backoff: 'exponential',
              initialDelayMs: 100,
              maxDelayMs: 10000,
            },
            onFailure: 'fail',
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Exponential Backoff Workflow',
        steps,
        ownerUserId: 'user_009',
      })
      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_009',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      for (let i = 0; i < 3; i++) {
        workflowRuntime.handleStepCompletion(stepRunId!, {
          success: false,
          error: `Attempt ${i + 1} failed`,
          errorCategory: 'timeout',
          recoverability: 'retryable_later',
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      const retryEvents = eventStore.query({ eventType: 'workflow_step_retry_scheduled' })
      expect(retryEvents.length).toBeGreaterThan(0)
    })

    it('should use fixed backoff', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Fixed Backoff Step',
          config: {
            toolName: 'test_tool',
            retryPolicyV2: {
              maxAttempts: 3,
              backoff: 'fixed',
              initialDelayMs: 500,
            },
            onFailure: 'fail',
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Fixed Backoff Workflow',
        steps,
        ownerUserId: 'user_010',
      })
      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_010',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      for (let i = 0; i < 2; i++) {
        workflowRuntime.handleStepCompletion(stepRunId!, {
          success: false,
          error: `Attempt ${i + 1} failed`,
          errorCategory: 'timeout',
          recoverability: 'retryable_later',
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      const retryEvents = eventStore.query({ eventType: 'workflow_step_retry_scheduled' })
      expect(retryEvents.length).toBeGreaterThan(0)
    })
  })

  describe('Audit Trail', () => {
    it('should record retry attempts in audit trail', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'tool_call',
          name: 'Audit Trail Step',
          config: {
            toolName: 'test_tool',
            retryPolicyV2: {
              maxAttempts: 3,
              backoff: 'none',
              retryableErrorCategories: ['timeout'],
            },
            onFailure: 'fail',
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Audit Trail Workflow',
        steps,
        ownerUserId: 'user_011',
      })
      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_011',
      })

      const stepRunId = result.stepRuns[0]?.stepRunId

      workflowRuntime.handleStepCompletion(stepRunId!, {
        success: false,
        error: 'First failure',
        errorCategory: 'timeout',
        recoverability: 'retryable_later',
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      const retryEvents = eventStore.query({ eventType: 'workflow_step_retry_scheduled' })
      expect(retryEvents.length).toBeGreaterThan(0)

      const retryEvent = retryEvents[0]
      expect(retryEvent?.payload).toHaveProperty('attempt')
      expect(retryEvent?.payload).toHaveProperty('maxAttempts')
      expect(retryEvent?.payload).toHaveProperty('delayMs')
    })
  })
})
