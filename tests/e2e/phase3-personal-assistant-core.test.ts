/**
 * Phase 3 E2E: Personal Assistant Core
 *
 * Tests the core personal assistant flows:
 * - Connector tool calls with mock connectors
 * - Planner/workflow/background state transitions
 * - Audit trail and event output
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js';
import { createMigrationRunner } from '../../src/storage/migrations.js';
import { allStoreMigrations } from '../../src/storage/all-stores-migrations.js';
import { createEventStore, type EventStore } from '../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../src/storage/runtime-action-store.js';
import { createWorkflowDraftStore } from '../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore } from '../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore } from '../../src/storage/workflow-run-store.js';
import { createBackgroundRunStore, type BackgroundRunStore } from '../../src/storage/background-run-store.js';
import { createConnectorStore } from '../../src/storage/connector-store.js';
import { createWorkflowRuntime } from '../../src/workflows/workflow-runtime.js';
import { createConnectorRuntime } from '../../src/connectors/connector-runtime.js';
import { createConnectorToolBridge, registerConnectorTools } from '../../src/connectors/connector-tool-bridge.js';
import { createToolRegistry } from '../../src/tools/tool-registry.js';
import { createBackgroundRuntime } from '../../src/subagents/background-runtime.js';
import { registerMockConnectors } from '../../src/connectors/mocks/index.js';
import { WORKFLOW_RUN_STATES } from '../../src/shared/states.js';
import type { WorkflowStep } from '../../src/workflows/types.js';
import type { ConnectorInstance } from '../../src/storage/connector-store.js';
import type { ConnectorRuntime } from '../../src/connectors/types.js';

describe('Phase 3 E2E: Personal Assistant Core', () => {
  let connection: ConnectionManager;
  let eventStore: EventStore;
  let runtimeActionStore: RuntimeActionStore;
  let backgroundRunStore: BackgroundRunStore;
  let workflowRuntime: ReturnType<typeof createWorkflowRuntime>;
  let connectorRuntime: ConnectorRuntime;
  let registry: ReturnType<typeof createToolRegistry>;
  let backgroundRuntime: ReturnType<typeof createBackgroundRuntime>;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    eventStore = createEventStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);
    const workflowDraftStore = createWorkflowDraftStore(connection);
    const workflowDefinitionStore = createWorkflowDefinitionStore(connection);
    const workflowRunStore = createWorkflowRunStore(connection);
    backgroundRunStore = createBackgroundRunStore(connection);
    const connectorStore = createConnectorStore(connection);

    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge: createConnectorToolBridge(),
      eventStore,
    });
    registerMockConnectors(connectorRuntime);

    registry = createToolRegistry();

    workflowRuntime = createWorkflowRuntime({
      draftStore: workflowDraftStore,
      definitionStore: workflowDefinitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
      dispatcher: {
        dispatch: async () => ({ success: true, result: {} }),
      },
    });

    backgroundRuntime = createBackgroundRuntime({
      backgroundRunStore,
      eventStore,
      maxConcurrentRuns: 2,
      watchdogTimeoutMs: 5000,
    });

    const emailInstance = registerMockConnectorInstance(connectorRuntime, 'gmail', 'messaging', 'mock-gmail-instance', 'test-user-001');
    const emailCapabilities = connectorRuntime.discoverCapabilities(emailInstance.id);
    registerConnectorTools(registry, { ...emailInstance, connectorId: 'gmail' }, emailCapabilities, { runtime: connectorRuntime });

    const docsInstance = registerMockConnectorInstance(connectorRuntime, 'docs', 'storage', 'mock-docs-instance', 'test-user-001');
    const docsCapabilities = connectorRuntime.discoverCapabilities(docsInstance.id);
    registerConnectorTools(registry, { ...docsInstance, connectorId: 'docs' }, docsCapabilities, { runtime: connectorRuntime });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('Connector tool calls', () => {
    it('should emit connector events when instances are created', () => {
      const events = eventStore.query({});
      const instanceEvents = events.filter(e =>
        e.eventType === 'connector_instance_created'
      );
      expect(instanceEvents.length).toBeGreaterThan(0);
    });

    it('should emit connector events when definitions are registered', () => {
      const events = eventStore.query({});
      const definitionEvents = events.filter(e =>
        e.eventType === 'connector_definition_registered'
      );
      expect(definitionEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Planner/workflow/background state', () => {
    it('should create and start workflow with connector tool step', async () => {
      const userId = 'test-user-001';
      const sessionId = 'session-workflow-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Search Emails',
          stepType: 'tool_call',
          config: {
            toolName: 'connector_gmail_search_emails',
            toolParams: { query: 'urgent' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Email Search Workflow',
        description: 'Searches emails for urgent items',
        steps,
        ownerUserId: userId,
      });

      expect(draft).toBeDefined();
      expect(draft.draftId).toBeDefined();

      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues.length).toBe(0);

      const definition = workflowRuntime.publishDraft(draft.draftId);
      expect(definition.status).toBe('published');
      expect(definition.workflowId).toBeDefined();

      const run = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
        inputData: {},
      });

      expect(run.status).toBe(WORKFLOW_RUN_STATES.RUNNING);
      expect(run.workflowRunId).toBeDefined();
      expect(run.currentStepIds).toContain('step_1');
    });

    it('should enqueue and start background run with status transitions', async () => {
      const userId = 'test-user-001';

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        agentType: 'research-agent',
        taskSpec: { objective: 'Research Phase 3 E2E patterns' },
        launchSource: 'planner',
      });

      expect(bgRunId).toBeDefined();
      expect(typeof bgRunId).toBe('string');

      const queuedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(queuedRun).toBeDefined();
      expect(queuedRun?.status).toBe('queued');
      expect(queuedRun?.userId).toBe(userId);
      expect(queuedRun?.agentType).toBe('research-agent');

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const runningRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(runningRun?.status).toBe('running');

      backgroundRuntime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Research completed successfully',
        toolCalls: [],
        iterationsUsed: 5,
      });

      const completedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(completedRun?.status).toBe('completed');
      expect(completedRun?.completedAt).toBeDefined();
      expect(completedRun?.resultData).toBeDefined();
    });

    it('should emit events for background run lifecycle', async () => {
      const userId = 'test-user-001';

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        agentType: 'test-agent',
        taskSpec: { objective: 'Test lifecycle events' },
        launchSource: 'test',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      // Check for BackgroundRunStarted event
      const events = eventStore.query({});
      const startedEvent = events.find(e =>
        e.eventType === 'BackgroundRunStarted' &&
        e.relatedRefs?.backgroundRunId === bgRunId
      );
      expect(startedEvent).toBeDefined();
      expect(startedEvent?.payload?.backgroundRunId).toBe(bgRunId);
    });

    it('should handle background run failure with error state', async () => {
      const userId = 'test-user-001';

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        agentType: 'failing-agent',
        taskSpec: { objective: 'This will fail' },
        launchSource: 'test',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      backgroundRuntime.failBackgroundRun(bgRunId, {
        code: 'EXECUTION_ERROR',
        message: 'Simulated failure for testing',
      });

      const failedRun = backgroundRuntime.getBackgroundRun(bgRunId);
      expect(failedRun?.status).toBe('failed');
    });
  });

  describe('Audit output', () => {
    it('should record workflow events in event store', async () => {
      const userId = 'test-user-001';
      const sessionId = 'session-audit-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Quick Task',
          stepType: 'tool_call',
          config: {
            toolName: 'connector_gmail_search_emails',
            toolParams: { query: 'test' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Audit Test Workflow',
        description: 'Tests audit trail',
        steps,
        ownerUserId: userId,
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
        inputData: {},
      });

      // Verify audit events
      const events = eventStore.query({ sessionId });
      expect(events.length).toBeGreaterThan(0);

      // Check for workflow-related events
      const hasWorkflowEvent = events.some(e => e.eventType.startsWith('workflow_'));
      expect(hasWorkflowEvent).toBe(true);

      // Verify event structure
      const workflowEvent = events.find(e => e.eventType.startsWith('workflow_'));
      expect(workflowEvent?.eventId).toBeDefined();
      expect(workflowEvent?.sourceModule).toBeDefined();
      expect(workflowEvent?.createdAt).toBeDefined();
      expect(workflowEvent?.payload).toBeDefined();
    });

    it('should include user and session context in audit events', async () => {
      const userId = 'test-user-context';
      const sessionId = 'session-context-001';

      const bgRunId = backgroundRuntime.enqueueBackgroundRun({
        userId,
        sessionId,
        agentType: 'context-agent',
        taskSpec: { objective: 'Test context tracking' },
        launchSource: 'test',
      });

      await backgroundRuntime.startBackgroundRun(bgRunId);

      const events = eventStore.query({ sessionId });
      expect(events.length).toBeGreaterThan(0);

      const contextEvent = events.find(e =>
        e.eventType === 'BackgroundRunStarted' &&
        e.userId === userId
      );
      expect(contextEvent).toBeDefined();
      expect(contextEvent?.userId).toBe(userId);
    });

    it('should track event correlation and causation', async () => {
      const userId = 'test-user-001';
      const sessionId = 'session-correlation-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'First Step',
          stepType: 'tool_call',
          config: {
            toolName: 'connector_docs_search_docs',
            toolParams: { query: 'test' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Correlation Test',
        description: 'Tests event correlation',
        steps,
        ownerUserId: userId,
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const run = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
        inputData: {},
      });

      const events = eventStore.query({ sessionId });

      const workflowEvents = events.filter(e =>
        e.relatedRefs?.workflowRunId === run.workflowRunId ||
        e.eventType?.startsWith('workflow_')
      );
      expect(workflowEvents.length).toBeGreaterThan(0);

      const eventsWithRelatedRefs = workflowEvents.filter(e => e.relatedRefs);
      expect(eventsWithRelatedRefs.length).toBeGreaterThan(0);
    });
  });
});

// Helper function to register mock connector instance
function registerMockConnectorInstance(
  runtime: ConnectorRuntime,
  connectorId: string,
  connectorType: 'api' | 'messaging' | 'storage' | 'database' | 'custom',
  instanceId: string,
  userId: string
): ConnectorInstance {
  const definition = runtime.registerDefinition({
    connectorId,
    name: `Mock ${connectorId} Connector`,
    connectorType,
    version: '1.0.0',
    capabilities: [],
    status: 'active',
  });

  return runtime.createInstance({
    connectorInstanceId: instanceId,
    connectorDefinitionId: definition.id,
    userId,
    name: `Test ${connectorId} Instance`,
    authStateRef: 'auth-mock-001',
    config: { connectorId },
    status: 'active',
  });
}
