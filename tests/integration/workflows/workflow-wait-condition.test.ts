import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createWorkflowDraftStore, type WorkflowDraftStore } from '../../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore, type WorkflowDefinitionStore } from '../../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore, type WorkflowRunStore } from '../../../src/storage/workflow-run-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createWaitConditionStore, type WaitConditionStore } from '../../../src/storage/wait-condition-store.js';
import { WORKFLOW_RUN_STATES } from '../../../src/shared/states.js';
import {
  createWorkflowRuntime,
  type WorkflowRuntime,
} from '../../../src/workflows/workflow-runtime.js';
import type {
  WorkflowStep,
} from '../../../src/workflows/types.js';
import { TestClock } from '../../helpers/clock.js';

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
      CREATE INDEX idx_workflow_defs_owner ON workflow_definitions(owner_user_id);
      CREATE INDEX idx_workflow_defs_status ON workflow_definitions(status);
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
      CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
      CREATE INDEX idx_workflow_runs_owner_status ON workflow_runs(owner_user_id, status);
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
      CREATE INDEX idx_workflow_step_runs_workflow_status ON workflow_step_runs(workflow_run_id, status);
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
      CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
      CREATE INDEX idx_runtime_actions_workflow_run ON runtime_actions(workflow_run_id);
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
      CREATE INDEX idx_events_type ON events(event_type);
      CREATE INDEX idx_events_correlation ON events(correlation_id);
    `,
    down: `DROP TABLE IF EXISTS events;`
  },
  {
    version: 7,
    name: 'create_wait_conditions_table',
    up: `
      CREATE TABLE wait_conditions (
        id TEXT PRIMARY KEY,
        wait_type TEXT NOT NULL,
        condition_pattern TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        timeout_at TEXT,
        satisfied_at TEXT,
        satisfied_by TEXT,
        result_data TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_wait_conditions_status ON wait_conditions(status);
      CREATE INDEX idx_wait_conditions_target ON wait_conditions(target_type, target_ref);
      CREATE INDEX idx_wait_conditions_timeout ON wait_conditions(timeout_at);
    `,
    down: `DROP TABLE IF EXISTS wait_conditions;`
  },
];

describe('Workflow Polling Wait Condition Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let draftStore: WorkflowDraftStore;
  let definitionStore: WorkflowDefinitionStore;
  let workflowRunStore: WorkflowRunStore;
  let runtimeActionStore: RuntimeActionStore;
  let eventStore: EventStore;
  let waitConditionStore: WaitConditionStore;
  let workflowRuntime: WorkflowRuntime;
  let clock: TestClock;

  beforeEach(() => {
    vi.useFakeTimers();

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
    waitConditionStore = createWaitConditionStore(connection);
    clock = new TestClock('2024-01-01T00:00:00.000Z');

    workflowRuntime = createWorkflowRuntime({
      draftStore,
      definitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
      waitConditionStore,
      clock: {
        now: () => clock.now(),
        nowISO: () => clock.nowISO(),
        advance: (ms: number) => clock.advance(ms),
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    connection?.close();
  });

  async function advanceRuntimeTimers(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  describe('Polling Wait Step', () => {
    it('should validate polling_wait step requires pollingCondition', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Invalid Polling Step',
          config: {
            timeoutMs: 5000,
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Polling Workflow',
        steps,
        ownerUserId: 'user_001',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.some(i => i.code === 'MISSING_POLLING_CONDITION')).toBe(true);
    });

    it('should validate polling_wait step requires timeoutMs', () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Invalid Polling Step',
          config: {
            pollingCondition: 'input.status == "ready"',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Invalid Polling Workflow',
        steps,
        ownerUserId: 'user_002',
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);

      expect(issues.some(i => i.code === 'MISSING_POLLING_TIMEOUT')).toBe(true);
    });

    it('should register wait condition when executing polling_wait step', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Polling Wait Step',
          config: {
            pollingCondition: 'input.status == "ready"',
            pollingIntervalMs: 100,
            timeoutMs: 5000,
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Polling Wait Workflow',
        steps,
        ownerUserId: 'user_003',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_003',
        inputData: { status: 'pending' },
      });

      await advanceRuntimeTimers(50);

      const waitConditions = waitConditionStore.findByStatus('active');
      expect(waitConditions.length).toBeGreaterThan(0);

      const waitCondition = waitConditions[0];
      expect(waitCondition?.waitType).toBe('polling');
      expect(waitCondition?.conditionPattern).toBe('input.status == "ready"');
      expect(waitCondition?.targetType).toBe('workflow_step_run');
      expect(waitCondition?.timeoutAt).toBeDefined();

      const registeredEvents = eventStore.query({ eventType: 'workflow_polling_wait_registered' });
      expect(registeredEvents.length).toBeGreaterThan(0);
    });

    it('should timeout when condition never satisfied', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Timeout Polling Step',
          config: {
            pollingCondition: 'input.status == "ready"',
            pollingIntervalMs: 100,
            timeoutMs: 500,
            onFailure: 'fail',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Timeout Polling Workflow',
        steps,
        ownerUserId: 'user_004',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_004',
        inputData: { status: 'pending' },
      });

      clock.advance(600);

      await advanceRuntimeTimers(100);

      const timeoutEvents = eventStore.query({ eventType: 'workflow_polling_wait_timeout' });
      expect(timeoutEvents.length).toBeGreaterThan(0);

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED);
    });

    it('should succeed when condition becomes satisfied', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Satisfied Polling Step',
          config: {
            pollingCondition: 'input.status == "ready"',
            pollingIntervalMs: 50,
            timeoutMs: 5000,
          },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Next Step',
          config: {
            toolName: 'test_tool',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Satisfied Polling Workflow',
        steps,
        ownerUserId: 'user_005',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_005',
        inputData: { status: 'ready' },
      });

      await advanceRuntimeTimers(100);

      const satisfiedEvents = eventStore.query({ eventType: 'workflow_polling_wait_satisfied' });
      expect(satisfiedEvents.length).toBeGreaterThan(0);

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.currentStepIds).toContain('step_002');
    });

    it('should record poll attempts', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Poll Attempts Step',
          config: {
            pollingCondition: 'input.status == "ready"',
            pollingIntervalMs: 50,
            timeoutMs: 200,
            onFailure: 'fail',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Poll Attempts Workflow',
        steps,
        ownerUserId: 'user_006',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_006',
        inputData: { status: 'pending' },
      });

      await advanceRuntimeTimers(50);

      const pollEvents = eventStore.query({ eventType: 'workflow_polling_wait_poll' });
      expect(pollEvents.length).toBeGreaterThan(0);

      const pollEvent = pollEvents[0];
      expect(pollEvent?.payload).toHaveProperty('pollAttempt');
      expect(pollEvent?.payload).toHaveProperty('nextPollInMs');
    });

    it('should handle expression error in polling condition', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Error Polling Step',
          config: {
            pollingCondition: 'undefinedVariable == "ready"',
            pollingIntervalMs: 50,
            timeoutMs: 5000,
            onFailure: 'fail',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Error Polling Workflow',
        steps,
        ownerUserId: 'user_007',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_007',
        inputData: { status: 'pending' },
      });

      await advanceRuntimeTimers(100);

      const errorEvents = eventStore.query({ eventType: 'workflow_polling_wait_error' });
      expect(errorEvents.length).toBeGreaterThan(0);

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.status).toBe(WORKFLOW_RUN_STATES.FAILED);
    });

    it('should apply onFailure=continue when polling times out', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Timeout Continue Step',
          config: {
            pollingCondition: 'input.status == "ready"',
            pollingIntervalMs: 50,
            timeoutMs: 200,
            onFailure: 'continue',
          },
          nextStepId: 'step_002',
        },
        {
          stepId: 'step_002',
          stepType: 'tool_call',
          name: 'Next Step',
          config: {
            toolName: 'test_tool',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Timeout Continue Workflow',
        steps,
        ownerUserId: 'user_008',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const result = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_008',
        inputData: { status: 'pending' },
      });

      clock.advance(300);

      await advanceRuntimeTimers(100);

      const updatedRun = workflowRuntime.getWorkflowRun(result.workflowRunId);
      expect(updatedRun?.currentStepIds).toContain('step_002');
    });

    it('should mark wait condition as satisfied when condition met', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Satisfied Wait Step',
          config: {
            pollingCondition: 'input.status == "ready"',
            pollingIntervalMs: 50,
            timeoutMs: 5000,
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Satisfied Wait Workflow',
        steps,
        ownerUserId: 'user_009',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_009',
        inputData: { status: 'ready' },
      });

      await advanceRuntimeTimers(100);

      const satisfiedConditions = waitConditionStore.findByStatus('satisfied');
      expect(satisfiedConditions.length).toBeGreaterThan(0);

      const waitCondition = satisfiedConditions[0];
      expect(waitCondition?.satisfiedAt).toBeDefined();
      expect(waitCondition?.satisfiedBy).toBe('polling_evaluator');
    });

    it('should mark wait condition as timeout when exceeded', async () => {
      const steps: WorkflowStep[] = [
        {
          stepId: 'step_001',
          stepType: 'polling_wait',
          name: 'Timeout Wait Step',
          config: {
            pollingCondition: 'input.status == "ready"',
            pollingIntervalMs: 50,
            timeoutMs: 100,
            onFailure: 'fail',
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Timeout Wait Workflow',
        steps,
        ownerUserId: 'user_010',
      });
      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId: 'user_010',
        inputData: { status: 'pending' },
      });

      clock.advance(200);

      await advanceRuntimeTimers(100);

      const timeoutConditions = waitConditionStore.findByStatus('timeout');
      expect(timeoutConditions.length).toBeGreaterThan(0);
    });
  });

  describe('Wait Condition Store Integration', () => {
    it('should create wait condition with correct fields', () => {
      const waitCondition = waitConditionStore.create({
        id: 'wait_test_001',
        waitType: 'polling',
        conditionPattern: 'input.status == "ready"',
        targetType: 'workflow_step_run',
        targetRef: 'step_run_001',
        status: 'active',
        priority: 5,
        timeoutAt: '2024-01-01T00:05:00.000Z',
        metadata: JSON.stringify({ pollingIntervalMs: 100 }),
      });

      expect(waitCondition.id).toBe('wait_test_001');
      expect(waitCondition.waitType).toBe('polling');
      expect(waitCondition.status).toBe('active');
      expect(waitCondition.priority).toBe(5);
      expect(waitCondition.timeoutAt).toBe('2024-01-01T00:05:00.000Z');
    });

    it('should find wait conditions by target', () => {
      waitConditionStore.create({
        id: 'wait_test_002',
        waitType: 'polling',
        conditionPattern: 'condition1',
        targetType: 'workflow_step_run',
        targetRef: 'step_run_002',
        status: 'active',
      });

      waitConditionStore.create({
        id: 'wait_test_003',
        waitType: 'event',
        conditionPattern: 'condition2',
        targetType: 'workflow_step_run',
        targetRef: 'step_run_002',
        status: 'active',
      });

      const conditions = waitConditionStore.findByTarget('workflow_step_run', 'step_run_002');
      expect(conditions.length).toBe(2);
    });

    it('should mark wait condition as satisfied', () => {
      waitConditionStore.create({
        id: 'wait_test_004',
        waitType: 'polling',
        conditionPattern: 'condition',
        targetType: 'workflow_step_run',
        targetRef: 'step_run_004',
        status: 'active',
      });

      const satisfied = waitConditionStore.markSatisfied('wait_test_004', 'test_evaluator', { result: 'success' });

      expect(satisfied.status).toBe('satisfied');
      expect(satisfied.satisfiedBy).toBe('test_evaluator');
      expect(satisfied.resultData).toEqual({ result: 'success' });
    });

    it('should mark wait condition as timeout', () => {
      waitConditionStore.create({
        id: 'wait_test_005',
        waitType: 'polling',
        conditionPattern: 'condition',
        targetType: 'workflow_step_run',
        targetRef: 'step_run_005',
        status: 'active',
        timeoutAt: '2024-01-01T00:01:00.000Z',
      });

      const timedOut = waitConditionStore.markTimeout('wait_test_005');

      expect(timedOut.status).toBe('timeout');
    });

    it('should find expired wait conditions', () => {
      waitConditionStore.create({
        id: 'wait_test_006',
        waitType: 'polling',
        conditionPattern: 'condition',
        targetType: 'workflow_step_run',
        targetRef: 'step_run_006',
        status: 'active',
        timeoutAt: '2024-01-01T00:00:30.000Z',
      });

      waitConditionStore.create({
        id: 'wait_test_007',
        waitType: 'polling',
        conditionPattern: 'condition',
        targetType: 'workflow_step_run',
        targetRef: 'step_run_007',
        status: 'active',
        timeoutAt: '2024-01-01T00:05:00.000Z',
      });

      const expired = waitConditionStore.findExpired('2024-01-01T00:01:00.000Z');
      expect(expired.length).toBe(1);
      expect(expired[0]?.id).toBe('wait_test_006');
    });
  });
});
