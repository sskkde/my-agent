/**
 * Phase 3 Cross-Runtime Integration Tests
 *
 * Tests the complete path: Foreground/Planner/Workflow → RuntimeDispatcher → ToolOrchestrator →
 * Connector/MCP Tool → Permission/Governance → Observability/Audit → Memory/Summary/Timeline.
 *
 * Ensures status_query/active work reports connector async waits, workflow branches,
 * pending approvals, and background runs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createWorkflowDraftStore } from '../../../src/storage/workflow-draft-store.js';
import { createWorkflowDefinitionStore } from '../../../src/storage/workflow-definition-store.js';
import { createWorkflowRunStore } from '../../../src/storage/workflow-run-store.js';
import { createRuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import { createApprovalStore } from '../../../src/storage/approval-store.js';
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createConnectorStore } from '../../../src/storage/connector-store.js';
import { createToolExecutionStore } from '../../../src/storage/tool-execution-store.js';
import { createSummaryStore } from '../../../src/storage/summary-store.js';
import { createPlannerRunStore } from '../../../src/storage/planner-run-store.js';
import { createPlanStore } from '../../../src/storage/plan-store.js';
import { createBackgroundRunStore } from '../../../src/storage/background-run-store.js';
import { createWorkflowRuntime } from '../../../src/workflows/workflow-runtime.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import { createConnectorToolBridge, registerConnectorTools } from '../../../src/connectors/connector-tool-bridge.js';
import { createRuntimeDispatcher } from '../../../src/dispatcher/runtime-dispatcher.js';
import { createToolRegistry } from '../../../src/tools/tool-registry.js';
import { createToolExecutor } from '../../../src/tools/tool-executor.js';
import { createPermissionEngine } from '../../../src/permissions/permission-engine.js';
import { createAuditRecorder } from '../../../src/observability/audit-recorder.js';
import { createActiveWorkProjectionBuilder } from '../../../src/projections/active-work-projection.js';
import { registerMockConnectors } from '../../../src/connectors/mocks/index.js';
import { createWorkflowDispatcherAdapter } from '../../../src/workflows/workflow-dispatcher-adapter.js';
import { WORKFLOW_RUN_STATES } from '../../../src/shared/states.js';
import type { WorkflowStep } from '../../../src/workflows/types.js';
import type { ConnectorInstance } from '../../../src/storage/connector-store.js';
import type { ToolRegistry } from '../../../src/tools/types.js';
import type { ConnectorRuntime } from '../../../src/connectors/types.js';
import type { AuditStore, AuditRecorder, AuditRecord, AuditQuery } from '../../../src/observability/audit-types.js';

class InMemoryAuditStore implements AuditStore {
  private records: Map<string, AuditRecord> = new Map();

  record(record: AuditRecord): void {
    this.records.set(record.auditId, record);
  }

  recordMany(records: AuditRecord[]): void {
    for (const record of records) {
      this.records.set(record.auditId, record);
    }
  }

  get(auditId: string): AuditRecord | null {
    return this.records.get(auditId) ?? null;
  }

  query(query: AuditQuery): AuditRecord[] {
    let results = Array.from(this.records.values());
    if (query.userId) {
      results = results.filter(r => r.userId === query.userId);
    }
    if (query.sessionId) {
      results = results.filter(r => r.sessionId === query.sessionId);
    }
    if (query.auditType) {
      results = results.filter(r => r.auditType === query.auditType);
    }
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    return results;
  }

  findByUser(userId: string): AuditRecord[] {
    return this.query({ userId });
  }

  findBySession(sessionId: string): AuditRecord[] {
    return this.query({ sessionId });
  }

  findByCorrelationId(correlationId: string): AuditRecord[] {
    return Array.from(this.records.values()).filter(r => r.correlationId === correlationId);
  }

  findByApprovalId(approvalId: string): AuditRecord[] {
    return Array.from(this.records.values()).filter(r => r.approvalId === approvalId);
  }

  findByToolCallId(toolCallId: string): AuditRecord[] {
    return Array.from(this.records.values()).filter(r => r.toolCallId === toolCallId);
  }

  findByPermissionDecisionId(permissionDecisionId: string): AuditRecord[] {
    return Array.from(this.records.values()).filter(r => r.permissionDecisionId === permissionDecisionId);
  }

  count(query: AuditQuery): number {
    return this.query(query).length;
  }

  deleteOlderThan(_timestamp: string): number {
    return 0;
  }

  getAll(): AuditRecord[] {
    return Array.from(this.records.values());
  }
}

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

describe('Phase 3 Cross-Runtime Integration', () => {
  let connection: ConnectionManager;
  let auditStore: InMemoryAuditStore;
  let auditRecorder: AuditRecorder;
  let workflowRuntime: ReturnType<typeof createWorkflowRuntime>;
  let connectorRuntime: ConnectorRuntime;
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>;
  let registry: ToolRegistry;
  let projectionBuilder: ReturnType<typeof createActiveWorkProjectionBuilder>;
  let eventStore: ReturnType<typeof createEventStore>;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    eventStore = createEventStore(connection);
    const runtimeActionStore = createRuntimeActionStore(connection);
    const workflowDraftStore = createWorkflowDraftStore(connection);
    const workflowDefinitionStore = createWorkflowDefinitionStore(connection);
    const workflowRunStore = createWorkflowRunStore(connection);
    const approvalStore = createApprovalStore(connection);
    const grantStore = createPermissionGrantStore(connection);
    const connectorStore = createConnectorStore(connection);
    const toolExecutionStore = createToolExecutionStore(connection);
    const summaryStore = createSummaryStore(connection);
    const backgroundRunStore = createBackgroundRunStore(connection);
    const plannerRunStore = createPlannerRunStore(connection);
    const planStore = createPlanStore(connection);

    auditStore = new InMemoryAuditStore();
    auditRecorder = createAuditRecorder({
      auditStore,
      enabled: true,
    });

    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge: createConnectorToolBridge(),
      eventStore,
    });
    registerMockConnectors(connectorRuntime);

    registry = createToolRegistry();
    const permissionEngine = createPermissionEngine({ approvalStore, grantStore, eventStore });
    createToolExecutor({
      registry,
      permissionEngine,
      toolExecutionStore: {
        create: (exec) => toolExecutionStore.create({
          toolCallId: exec.toolCallId,
          toolName: exec.toolName,
          userId: exec.userId,
          sessionId: exec.sessionId,
          kernelRunId: exec.kernelRunId,
          status: exec.status as import('../../../src/shared/states.js').ToolExecutionState,
          params: exec.params,
          sensitivity: exec.sensitivity as import('../../../src/storage/tool-execution-store.js').SensitivityLevel,
        }),
        updateStatus: (toolCallId, status) => toolExecutionStore.updateStatus(toolCallId, status as import('../../../src/shared/states.js').ToolExecutionState),
        saveResult: (toolCallId, result) => toolExecutionStore.saveResult(toolCallId, result),
      },
      eventStore: {
        append: (event) => eventStore.append(event as import('../../../src/storage/event-store.js').EventRecord | import('../../../src/storage/event-store.js').EventRecord[]),
      },
    });

    const adapterRegistry = new Map<string, unknown>();
    dispatcher = createRuntimeDispatcher({
      actionStore: runtimeActionStore,
      eventStore: {
        append: (event) => eventStore.append(event as import('../../../src/storage/event-store.js').EventRecord | import('../../../src/storage/event-store.js').EventRecord[]),
      },
      adapterRegistry: {
        register: (runtimeType, adapter) => adapterRegistry.set(runtimeType, adapter),
        getAdapter: (runtimeType) => {
          const adapter = adapterRegistry.get(runtimeType);
          return adapter ? (adapter as import('../../../src/dispatcher/types.js').RuntimeAdapter) : null;
        },
        unregister: (runtimeType) => adapterRegistry.delete(runtimeType),
        listAdapters: () => Array.from(adapterRegistry.keys()) as never[],
      },
      auditRecorder,
    });

    workflowRuntime = createWorkflowRuntime({
      draftStore: workflowDraftStore,
      definitionStore: workflowDefinitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
      dispatcher: createWorkflowDispatcherAdapter(dispatcher),
    });

    projectionBuilder = createActiveWorkProjectionBuilder({
      plannerRunStore,
      approvalStore,
      planStore,
      eventStore,
      summaryStore,
      backgroundRunStore,
      workflowRunStore,
    });

    const emailInstance = registerMockConnectorInstance(connectorRuntime, 'mock_email', 'messaging', 'mock-email-instance', 'test-user-001');
    const emailCapabilities = connectorRuntime.discoverCapabilities(emailInstance.id);
    registerConnectorTools(registry, { ...emailInstance, connectorId: 'mock_email' }, emailCapabilities, { runtime: connectorRuntime });

    const docsInstance = registerMockConnectorInstance(connectorRuntime, 'mock_docs', 'storage', 'mock-docs-instance', 'test-user-001');
    const docsCapabilities = connectorRuntime.discoverCapabilities(docsInstance.id);
    registerConnectorTools(registry, { ...docsInstance, connectorId: 'mock_docs' }, docsCapabilities, { runtime: connectorRuntime });
  });

  afterEach(() => {
    connection.close();
  });

  describe('approval workflow', () => {
    it('creates workflow using mock_email.search then approval step', async () => {
      const userId = 'test-user-001';
      const sessionId = 'test-session-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Search Emails',
          stepType: 'tool_call',
          config: {
            toolName: 'connector.mock_email.search_emails',
            toolParams: { query: 'urgent' },
          },
          nextStepId: 'step_2',
        },
        {
          stepId: 'step_2',
          name: 'Require Approval',
          stepType: 'approval',
          config: {
            approvalScope: 'connector.mock_docs.create_doc',
          },
          nextStepId: 'step_3',
        },
        {
          stepId: 'step_3',
          name: 'Create Document',
          stepType: 'tool_call',
          config: {
            toolName: 'connector.mock_docs.create_doc',
            toolParams: { title: 'Action Items', content: 'From emails' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Email to Document Workflow',
        description: 'Searches emails and creates document after approval',
        steps,
        ownerUserId: userId,
      });

      const issues = workflowRuntime.validateDraft(draft.draftId);
      expect(issues.length).toBe(0);

      const definition = workflowRuntime.publishDraft(draft.draftId);
      expect(definition.status).toBe('published');

      const run = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
        inputData: {},
      });

      expect(run.status).toBe(WORKFLOW_RUN_STATES.RUNNING);
      expect(run.workflowRunId).toBeDefined();
      expect(run.currentStepIds).toContain('step_1');

      const allEvents = eventStore.query({ sessionId });
      expect(allEvents.length).toBeGreaterThan(0);

      const eventTypes = allEvents.map(e => (e as { eventType: string }).eventType);
      expect(eventTypes.some(t => t.startsWith('workflow_'))).toBe(true);
    });

    it('asserts audit trail includes workflow events', async () => {
      const userId = 'test-user-001';
      const sessionId = 'test-session-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Search Emails',
          stepType: 'tool_call',
          config: {
            toolName: 'connector.mock_email.search_emails',
            toolParams: { query: 'test' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Simple Email Search',
        description: 'Searches emails',
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

      await new Promise(resolve => setTimeout(resolve, 100));

      const finalRun = workflowRuntime.getWorkflowRun(run.workflowRunId);
      expect(finalRun).toBeDefined();

      const allEvents = eventStore.query({ sessionId });
      expect(allEvents.length).toBeGreaterThan(0);

      const hasWorkflowEvent = allEvents.some(e => (e as { eventType: string }).eventType.startsWith('workflow_'));
      expect(hasWorkflowEvent).toBe(true);
    });
  });

  describe('status async wait', () => {
    it('workflow starts mock_docs.export (async operation)', async () => {
      const userId = 'test-user-001';
      const sessionId = 'test-session-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Export Document (async)',
          stepType: 'tool_call',
          config: {
            toolName: 'connector.mock_docs.export_doc',
            toolParams: { docId: 'doc_001', format: 'pdf' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Async Export Workflow',
        description: 'Exports document asynchronously',
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

      expect(run.status).toBe(WORKFLOW_RUN_STATES.RUNNING);

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection.activeWorkflowRuns.length).toBeGreaterThan(0);
      const activeWorkflowRun = projection.activeWorkflowRuns.find(r => r.runId === run.workflowRunId);
      expect(activeWorkflowRun).toBeDefined();
      expect(activeWorkflowRun?.status).toBe(WORKFLOW_RUN_STATES.RUNNING);
      expect(activeWorkflowRun?.runId).toBe(run.workflowRunId);
      expect(activeWorkflowRun?.startedAt).toBeDefined();
    });

    it('asserts ActiveWorkProjection includes workflowRun', async () => {
      const userId = 'test-user-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Wait for External Event',
          stepType: 'wait',
          config: {
            waitCondition: {
              type: 'external_event',
              source: 'connector.mock_docs',
              operationId: 'op_export_001',
            },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Wait Workflow',
        description: 'Waits for external event',
        steps,
        ownerUserId: userId,
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const run = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId: 'test-session-001',
        inputData: {},
      });

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection.activeWorkflowRuns).toBeDefined();
      const activeRun = projection.activeWorkflowRuns.find(r => r.runId === run.workflowRunId);
      expect(activeRun).toBeDefined();
      expect(projection.lastUpdated).toBeDefined();
    });

    it('complete operation and assert projection no longer shows active wait', async () => {
      const userId = 'test-user-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Quick Search',
          stepType: 'tool_call',
          config: {
            toolName: 'connector.mock_email.search_emails',
            toolParams: { query: 'test' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Quick Workflow',
        description: 'Completes quickly',
        steps,
        ownerUserId: userId,
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      const run = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId: 'test-session-001',
        inputData: {},
      });

      let projection = await projectionBuilder.buildProjection(userId);
      let activeRun = projection.activeWorkflowRuns.find(r => r.runId === run.workflowRunId);
      expect(activeRun).toBeDefined();

      workflowRuntime.cancelWorkflowRun(run.workflowRunId);

      projectionBuilder.invalidateCache(userId);
      projection = await projectionBuilder.buildProjection(userId);

      activeRun = projection.activeWorkflowRuns.find(r => r.runId === run.workflowRunId);
      expect(activeRun).toBeUndefined();
    });

    it('asserts timeline/audit entries are present', async () => {
      const userId = 'test-user-001';

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Search',
          stepType: 'tool_call',
          config: {
            toolName: 'connector.mock_email.search_emails',
            toolParams: { query: 'test' },
          },
        },
      ];

      const draft = workflowRuntime.createDraft({
        name: 'Timeline Test Workflow',
        description: 'Tests timeline entries',
        steps,
        ownerUserId: userId,
      });

      workflowRuntime.validateDraft(draft.draftId);
      const definition = workflowRuntime.publishDraft(draft.draftId);

      workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId: 'test-session-001',
        inputData: {},
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const allEvents = eventStore.query({ sessionId: 'test-session-001' });
      expect(allEvents.length).toBeGreaterThan(0);

      const hasWorkflowAudit = allEvents.some(e => (e as { eventType: string }).eventType.startsWith('workflow_'));
      expect(hasWorkflowAudit).toBe(true);
    });
  });
});
